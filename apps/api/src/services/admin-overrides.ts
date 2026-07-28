import { eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { adminAudit, games } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  ERROR_CODE,
  isStartedStatus,
  type GameOverrideRequest,
  type GameOverrideResponse,
} from "@picksleagues/schemas";
import { logError } from "../lib/logger";
import { loadAdminGame } from "./admin-data";
import { resolveGameOverrides } from "./games";
import { settlePicksForGames } from "./pickem/settlement";
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

/** Three-state merge: `undefined` leaves the stored override, `null` clears it. */
function merge<T>(patch: T | null | undefined, stored: T | null): T | null {
  return patch === undefined ? stored : patch;
}

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
    };

    // Precedence resolved through its one home (arch D15) rather than restated,
    // so the guard below reasons about exactly the kickoff and status the rest
    // of the app will.
    const after = resolveGameOverrides({ ...game, ...next }, null);

    /**
     * The invariant, stated on the state this write would *leave behind*: a
     * game is never left unlocked while its outcome is already knowable. Lock
     * state is derived, never stored (arch D11), so such a game is one every
     * member can pick against an outcome the app is already serving them — the
     * pick mutation's `kickoff_at > now` check passes and settlement grades it a
     * guaranteed win. The spec is explicit that even a genuine postponement does
     * not re-open picks (§Cancellations, Postponements & Re-picks: "resolves
     * normally when played. No re-pick.").
     *
     * "Knowable" is a started status OR a resolved score, and the second
     * disjunct is not redundant: `postponed` is legitimately not a started
     * status, yet a postponed game carrying the provider's score renders that
     * score everywhere a non-`scheduled` game's status is shown (the week
     * detail's status+score line), and the resolved score is serialized on the
     * slate regardless. A score is exactly as knowable as a status.
     *
     * Deliberately NOT a before/after transition test: every conjunct of one
     * would read a single request's own pair, so the same end state is reachable
     * by splitting the edit across requests (set `scheduled`, move the kickoff,
     * then clear the status) or by never touching the kickoff at all (correct a
     * final score on a game whose provider kickoff is wrongly in the future).
     * Only the result is checkable once.
     *
     * The legitimate cases survive: moving a kickoff earlier only ever locks, a
     * genuinely postponed game with no score anywhere is still reschedulable,
     * and the audited escape hatch for a provider that wrongly marked a game
     * played is to assert the true state in one request — `scheduled` plus, when
     * an override put the scores there, nulling them back out.
     *
     * Evaluated only when the request supplies one of the two inputs to the
     * resolved lock state's counterpart. A provider bug can leave a game already
     * violating this (kickoff in the future, status `final`) with no override in
     * sight; an unrelated score or spread correction on that game neither
     * creates nor deepens the violation, and refusing it would make the rest of
     * the row unfixable. A no-op status/kickoff write on such a row is refused
     * rather than special-cased — narrowing further would mean comparing against
     * the prior state again, which is the escapability this guard exists to
     * avoid.
     */
    const touchesLockState = request.kickoffAt !== undefined || request.status !== undefined;
    const outcomeKnowable =
      isStartedStatus(after.status) || after.homeScore !== null || after.awayScore !== null;
    if (touchesLockState && !isLocked(after.kickoffAt, now) && outcomeKnowable) {
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
