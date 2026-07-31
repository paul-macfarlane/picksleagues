import { desc, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { oddsSnapshots } from "@picksleagues/db";

/**
 * The single home for "the current spread for these games". `odds_snapshots` is
 * append-only history (one row per game per odds sync), so "current" always
 * means the most recent snapshot — a rule the admin browser, the pick slate,
 * and pick-time spread validation must all agree on, or a member could accept a
 * number the write path then rejects as stale.
 *
 * Note this is the *provider* spread only. Override precedence over it lives in
 * `resolveGameOverrides` (arch D15) and is applied by callers.
 */

export interface LatestSpread {
  spread: number;
  capturedAt: Date;
}

export async function latestSpreadsForGames(
  db: Db,
  gameIds: readonly string[],
): Promise<Map<string, LatestSpread>> {
  if (gameIds.length === 0) return new Map();

  const rows = await db
    .selectDistinctOn([oddsSnapshots.gameId], {
      gameId: oddsSnapshots.gameId,
      spread: oddsSnapshots.spread,
      capturedAt: oddsSnapshots.capturedAt,
    })
    .from(oddsSnapshots)
    .where(inArray(oddsSnapshots.gameId, [...gameIds]))
    // `id` breaks the tie: a sync run stamps every row it inserts with one
    // `clock.now()`, so two snapshots for a game CAN share `captured_at`
    // exactly (trivially so under the simulator's fixed clock) and DISTINCT ON
    // would otherwise pick between them arbitrarily.
    .orderBy(oddsSnapshots.gameId, desc(oddsSnapshots.capturedAt), desc(oddsSnapshots.id));

  return new Map(
    rows.map((row) => [row.gameId, { spread: row.spread, capturedAt: row.capturedAt }]),
  );
}
