import { eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { adminAudit, games } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  ERROR_CODE,
  GAME_STATUS,
  type AdminGame,
  type GameOverrideRequest,
} from "@picksleagues/schemas";
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
  | { ok: true; game: AdminGame }
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
    // both before and after, so the lock guard below reasons about exactly the
    // kickoff the rest of the app will.
    const before = resolveGameOverrides(game, null);
    const after = resolveGameOverrides({ ...game, ...next }, null);

    /**
     * Lock state is derived, never stored (arch D11), so moving a kickoff moves
     * the lock retroactively. Moving it *earlier* is the correction this feature
     * exists for — it closes a window that should already have been closed.
     * Moving it *later* re-opens picks, and on a game that has started or
     * finished that hands every member a free edit against a known outcome,
     * after their opponents' picks were already revealed at the old kickoff.
     * The spec is explicit that even a genuine postponement does not re-open
     * picks (§Cancellations, Postponements & Re-picks: "resolves normally when
     * played. No re-pick.").
     *
     * So: refuse the unlock unless the resolved status says the game hasn't
     * started. That leaves the legitimate case working — a provider kickoff
     * that was simply wrong, on a game still `scheduled` — and gives the
     * genuinely-mistaken-status case an explicit, audited escape hatch: send
     * `status: "scheduled"` in the same request as the new kickoff.
     */
    if (
      isLocked(before.kickoffAt, now) &&
      !isLocked(after.kickoffAt, now) &&
      after.status !== GAME_STATUS.SCHEDULED
    ) {
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
   */
  await settlePicksForGames(db, clock, [gameId]);

  const game = await loadAdminGame(db, gameId);
  if (!game) {
    // The row was locked and updated moments ago; a miss here means it was
    // deleted out from under us, which nothing in the app can do.
    throw new Error(`setGameOverride: game ${gameId} vanished after a successful write`);
  }
  return { ok: true, game };
}
