import { eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { adminAudit, games, teams } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  ERROR_CODE,
  isStartedStatus,
  type AdminTeam,
  type GameOverrideRequest,
  type GameOverrideResponse,
  type TeamIdentityOverrideRequest,
} from "@picksleagues/schemas";
import { logError } from "../lib/logger";
import { mergeOverrideField as merge } from "../lib/override-merge";
import { loadAdminGame, loadAdminTeam } from "./admin-data";
import { resolveGameOverrides, type ResolvedGame } from "./games";
import { settlePicksForGames } from "./settlement";
import { isLocked } from "./slate";

/**
 * The only prod-facing edit path for sports data (arch §Manual Sports Data
 * Overrides, D15): an admin writes the `override_*` parallels, ingestion keeps
 * owning the provider columns, and every read resolves
 * `override_* ?? provider_*`. Kept out of `admin-data.ts` (read-only by
 * construction) and out of `games.ts` (the pure precedence helper, zero I/O).
 */

export type SetGameOverrideResult =
  | ({ ok: true } & GameOverrideResponse)
  | { ok: false; reason: typeof ERROR_CODE.GAME_NOT_FOUND }
  | { ok: false; reason: typeof ERROR_CODE.OVERRIDE_UNLOCKS_GAME };

export async function setGameOverride(
  db: Db,
  clock: Clock,
  adminUserId: string,
  gameId: string,
  request: GameOverrideRequest,
): Promise<SetGameOverrideResult> {
  const now = clock.now();

  const outcome = await db.transaction(async (tx) => {
    // FOR UPDATE: two admins correcting the same game must not each capture the
    // other's pre-write state as "prior value" — that would leave an audit trail
    // that can't be replayed backwards.
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).for("update");
    if (!game) return { ok: false as const, reason: ERROR_CODE.GAME_NOT_FOUND };

    const next = {
      overrideKickoffAt: merge(
        // A supplied instant is a value the operator typed, not a "now" read —
        // the sanctioned exception to the Clock rule (arch D13).
        request.kickoffAt === undefined || request.kickoffAt === null
          ? request.kickoffAt
          : new Date(request.kickoffAt),
        game.overrideKickoffAt,
      ),
      overrideStatus: merge(request.status, game.overrideStatus),
      overrideHomeScore: merge(request.homeScore, game.overrideHomeScore),
      overrideAwayScore: merge(request.awayScore, game.overrideAwayScore),
      overrideSpread: merge(request.spread, game.overrideSpread),
      overridePeriod: merge(request.period, game.overridePeriod),
      overrideClockSeconds: merge(request.clockSeconds, game.overrideClockSeconds),
    };

    // Precedence resolved through its one home (arch D15) rather than restated,
    // both before and after, so the guard below reasons about exactly the
    // kickoff, status and scores the rest of the app will.
    const before = resolveGameOverrides(game);
    const after = resolveGameOverrides({ ...game, ...next });

    /**
     * The invariant: a game is never left unlocked while its outcome is already
     * knowable. Lock state is derived, never stored (arch D11), so such a game
     * is one every member can still pick against an outcome the app is already
     * serving them — the pick mutation's `kickoff_at > now` check passes and
     * settlement grades it a guaranteed win. The spec is explicit that even a
     * genuine postponement does not re-open picks (§Cancellations &
     * Postponements: "pick resolves normally when played").
     *
     * "Knowable" is a started status OR a resolved score, and the score disjunct
     * is not redundant with the status one. `postponed` is legitimately not a
     * started status, yet a postponed game carrying a score renders it wherever
     * a non-`scheduled` status is shown, and `serializeSlateGame` puts the
     * resolved scores on the wire for every status. A score is exactly as
     * knowable as a status, and a score-only write can create the violation
     * without touching kickoff or status at all.
     *
     * The whole predicate is evaluated on *each* resolved state and the write is
     * refused only where the violation is new. That is emphatically not the
     * escapable transition test this guard started as, and the difference is the
     * thing to preserve: the original compared *different conjuncts* across the
     * pair (before's lock state against after's status), so a sequence could
     * walk to a forbidden state one individually-legal step at a time. Here each
     * state is judged whole, so no single request can take a non-violating row
     * to a violating one — and therefore, by induction over the sequence, no
     * series of requests can either. Do not "simplify" this back into a
     * per-request diff of individual fields.
     *
     * Comparing against `before` at all is what keeps an already-violating row
     * fully editable: the violation pre-exists, so score and spread corrections
     * on it still land. Note this is a genuine carve-out, not a no-op — every
     * request on such a row is permitted, including ones that leave it
     * violating. `V` is a boolean; there is no depth to refuse.
     *
     * Two routes reach that state, and neither is admission-controllable here.
     * A provider bug (a future kickoff on a game it already reports final), and
     * — legitimately — an admin moving a kickoff *later* on a scheduled unscored
     * game, which is allowed because nothing is knowable yet, after which
     * `sync-scores` gates on the **provider** kickoff (not the effective one)
     * and writes the final score while our effective kickoff is still ahead.
     * Ingestion writes only provider columns and must never fail on account of a
     * correction, so it cannot consult this guard. Detecting and repairing
     * `unlocked ∧ outcome-knowable` rows is therefore an operational concern
     * (ADM-3's audit surface is the natural home), not something this endpoint
     * can prevent. What it *does* guarantee: nothing an admin does through this
     * API moves a non-violating row into the carve-out.
     *
     * The legitimate cases survive: moving a kickoff earlier only ever locks, a
     * genuinely postponed game with no score anywhere is still reschedulable,
     * and the audited escape hatch for a provider that wrongly marked a game
     * played is to assert the true state in one request — `scheduled` plus, when
     * an override put the scores there, nulling them back out.
     */
    const leavesOutcomeKnowableButUnlocked = (state: ResolvedGame) =>
      !isLocked(state.kickoffAt, now) &&
      (isStartedStatus(state.status) || state.homeScore !== null || state.awayScore !== null);

    if (leavesOutcomeKnowableButUnlocked(after) && !leavesOutcomeKnowableButUnlocked(before)) {
      return { ok: false as const, reason: ERROR_CODE.OVERRIDE_UNLOCKS_GAME };
    }

    const stillOverridden = Object.values(next).some((value) => value !== null);

    await tx
      .update(games)
      .set({
        ...next,
        // Cleared alongside the last override so a fully-cleared row is
        // indistinguishable from one never corrected — "clearing an override
        // cleanly reverts to provider truth" (arch D15). The history the
        // attribution used to carry now lives in `admin_audit`.
        overriddenBy: stillOverridden ? adminUserId : null,
        overriddenAt: stillOverridden ? now : null,
        updatedAt: now,
      })
      .where(eq(games.id, gameId));

    // Same transaction as the write it describes: an override that committed
    // without its audit row, or an audit row for a write that rolled back,
    // are both worse than the whole request failing.
    await tx.insert(adminAudit).values({
      adminUserId,
      action: ADMIN_AUDIT_ACTION.GAME_OVERRIDE,
      targetTable: ADMIN_AUDIT_TARGET_TABLE.GAMES,
      targetId: gameId,
      // Only the override layer: the provider columns are untouched by this
      // write, so replaying the prior value restores exactly what changed.
      priorValue: {
        overrideKickoffAt: game.overrideKickoffAt?.toISOString() ?? null,
        overrideStatus: game.overrideStatus,
        overrideHomeScore: game.overrideHomeScore,
        overrideAwayScore: game.overrideAwayScore,
        overrideSpread: game.overrideSpread,
        overridePeriod: game.overridePeriod,
        overrideClockSeconds: game.overrideClockSeconds,
        overriddenBy: game.overriddenBy,
        overriddenAt: game.overriddenAt?.toISOString() ?? null,
      },
      createdAt: now,
    });

    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;

  /**
   * Recompute after the correction commits, not inside its transaction (arch
   * §Overrides: "applying or clearing an override triggers settlement recompute
   * for affected leagues"). Deliberately the same entry point `sync-scores` and
   * `sync-schedule` use — a second settlement path is how two callers start
   * disagreeing about what a game means.
   *
   * Outside the transaction because settlement takes a per-league-season lock
   * and is a pure derivation the nightly sweep re-runs anyway (arch D10): a
   * settlement failure must not roll back the correction that outlives it.
   * Run unconditionally rather than only for score/status edits — it is
   * idempotent, and deciding which fields settlement reads here would be a
   * second copy of that knowledge.
   *
   * By the same token its failure is reported, not thrown: the override is
   * already committed and audited, so a 500 here would tell the admin the
   * correction failed, show them pre-override values, and invite a retry that
   * writes a second audit row. The caller says "saved, not yet re-settled"
   * instead and the sweep repairs the derivation.
   */
  let resettled = true;
  try {
    await settlePicksForGames(db, clock, [gameId]);
  } catch (error) {
    resettled = false;
    logError("admin-override.settlement-failed", { gameId, adminUserId, error });
  }

  const game = await loadAdminGame(db, gameId);
  if (!game) {
    // The row was locked and updated moments ago; a miss here means it was
    // deleted out from under us, which nothing in the app can do.
    throw new Error(`setGameOverride: game ${gameId} vanished after a successful write`);
  }
  return { ok: true, game, resettled };
}

export type SetTeamIdentityOverrideResult =
  { ok: true; team: AdminTeam } | { ok: false; reason: typeof ERROR_CODE.TEAM_NOT_FOUND };

/**
 * The correction path for team identity (STAT-8, ADR-0042): the `games`
 * mechanics exactly — FOR UPDATE, three-state merge, audit in the same
 * transaction — but with neither of that write's extra obligations. No lock
 * guard and no settlement recompute, because identity is display data that
 * feeds no outcome; and no sync clobber risk by construction, since ingestion
 * writes only the provider columns (arch D15).
 */
export async function setTeamIdentityOverride(
  db: Db,
  clock: Clock,
  adminUserId: string,
  teamId: string,
  request: TeamIdentityOverrideRequest,
): Promise<SetTeamIdentityOverrideResult> {
  const now = clock.now();

  const outcome = await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) return { ok: false as const, reason: ERROR_CODE.TEAM_NOT_FOUND };

    const next = {
      overrideName: merge(request.name, team.overrideName),
      overrideAbbreviation: merge(request.abbreviation, team.overrideAbbreviation),
      overrideLocation: merge(request.location, team.overrideLocation),
      overrideLogoLightUrl: merge(request.logoLightUrl, team.overrideLogoLightUrl),
      overrideLogoDarkUrl: merge(request.logoDarkUrl, team.overrideLogoDarkUrl),
    };
    const stillOverridden = Object.values(next).some((value) => value !== null);

    await tx
      .update(teams)
      .set({
        ...next,
        // Cleared alongside the last override so a fully-cleared row is
        // indistinguishable from one never corrected (arch D15); the history
        // lives in `admin_audit`.
        overriddenBy: stillOverridden ? adminUserId : null,
        overriddenAt: stillOverridden ? now : null,
        updatedAt: now,
      })
      .where(eq(teams.id, teamId));

    // Same transaction as the write it describes (arch D15): only the override
    // layer, since the provider columns are untouched here.
    await tx.insert(adminAudit).values({
      adminUserId,
      action: ADMIN_AUDIT_ACTION.TEAM_IDENTITY_OVERRIDE,
      targetTable: ADMIN_AUDIT_TARGET_TABLE.TEAMS,
      targetId: teamId,
      priorValue: {
        overrideName: team.overrideName,
        overrideAbbreviation: team.overrideAbbreviation,
        overrideLocation: team.overrideLocation,
        overrideLogoLightUrl: team.overrideLogoLightUrl,
        overrideLogoDarkUrl: team.overrideLogoDarkUrl,
        overriddenBy: team.overriddenBy,
        overriddenAt: team.overriddenAt?.toISOString() ?? null,
      },
      createdAt: now,
    });

    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;

  const team = await loadAdminTeam(db, teamId);
  if (!team) {
    // Locked and updated moments ago; a miss means the row was deleted out
    // from under us, which nothing in the app can do.
    throw new Error(`setTeamIdentityOverride: team ${teamId} vanished after a successful write`);
  }
  return { ok: true, team };
}
