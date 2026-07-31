import { count, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { pickemPicks } from "@picksleagues/db";
import { logWarn } from "../../lib/logger";

/**
 * `pickem_picks.side` stores "home"/"away" rather than a team id so a pick
 * survives a provider correction to a game's teams (see the rationale on
 * `packages/schemas/src/pickem-pick-side.ts`) — but that same tradeoff means a
 * *swap* silently repoints an existing pick at the other team. Schedule sync
 * still applies the correction, because refusing it would leave the game row
 * permanently wrong; this only surfaces the case where picks were already
 * riding on the old assignment, so a human can decide whether the affected
 * league-week needs an override.
 *
 * No in-app alerting by design (ADR-0007) — the warning goes to the log the
 * job's own failure notifications already surface.
 *
 * Callers must gate this on an actual team change: the pick-count lookup is a
 * per-game query and has no business running on the unchanged hot path.
 */
export async function warnOnTeamCorrectionWithPicks(
  db: Db,
  correction: {
    gameId: string;
    providerGameId: string;
    previousHomeTeamId: string;
    previousAwayTeamId: string;
    newHomeTeamId: string;
    newAwayTeamId: string;
  },
): Promise<void> {
  const [pickRow] = await db
    .select({ value: count() })
    .from(pickemPicks)
    .where(eq(pickemPicks.gameId, correction.gameId));

  const affectedPicks = pickRow?.value ?? 0;
  if (affectedPicks === 0) return;

  logWarn("nfl-sync-schedule.team-correction-with-picks", { ...correction, affectedPicks });
}
