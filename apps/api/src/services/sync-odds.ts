import { and, asc, eq, gt, lte } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, oddsSnapshots, sportSeasons, weeks } from "@picksleagues/db";
import { type Clock, type GameDataProvider, nflSeasonYearFor } from "@picksleagues/core";
import { GAME_STATUS, SPORT } from "@picksleagues/schemas";

/**
 * Captures a point-in-time odds snapshot for each unstarted game in the
 * current NFL week (arch §External Data). Each run appends a new snapshot per
 * game — history is intentional (the spread a pick locked against is the
 * latest snapshot at kickoff), so this is not idempotent in row count but is
 * safe to re-run: nothing else is mutated.
 *
 * Never inserts or updates `games`/`weeks` (that is schedule-sync's job) and
 * never writes any `override_*` column (arch D15).
 */
export async function syncOdds(
  db: Db,
  clock: Clock,
  provider: GameDataProvider,
  opts?: { seasonYear?: number; weekNumber?: number },
): Promise<Record<string, string | number | boolean>> {
  const seasonYear = opts?.seasonYear ?? nflSeasonYearFor(clock.now());
  // One instant for every comparison and for capturedAt, reaching SQL as a
  // bound parameter (arch D13).
  const now = clock.now();

  const [season] = await db
    .select({ id: sportSeasons.id })
    .from(sportSeasons)
    .where(and(eq(sportSeasons.sport, SPORT.NFL), eq(sportSeasons.year, seasonYear)));
  if (!season) {
    // Sync jobs never create reference data — schedule-sync owns season/week
    // creation (feedback: recurring syncs query reference data, don't upsert it).
    return { skipped: true, reason: "season_not_synced" };
  }

  const targetWeek = await resolveTargetWeek(db, season.id, now, opts?.weekNumber);
  if (!targetWeek) {
    return { skipped: true, reason: "no_current_week" };
  }

  // Our tables are the source of truth for what's unstarted — lock state is
  // derived, never stored (arch D11): kickoff still in the future and status
  // untouched by any in-progress/final transition.
  const unstartedGames = await db
    .select({ id: games.id, providerGameId: games.providerGameId })
    .from(games)
    .where(
      and(
        eq(games.weekId, targetWeek.id),
        gt(games.kickoffAt, now),
        eq(games.status, GAME_STATUS.SCHEDULED),
      ),
    );

  if (unstartedGames.length === 0) {
    return {
      seasonYear,
      weekNumber: targetWeek.weekNumber,
      unstartedGames: 0,
      snapshotsInserted: 0,
      gamesWithoutOdds: 0,
    };
  }

  // Network read outside any transaction (engineering rules: never hold a
  // transaction open across a network call).
  const providerGames = await provider.fetchWeekGames(seasonYear, targetWeek.weekNumber);
  const spreadByProviderId = new Map(
    providerGames.map((game) => [game.providerGameId, game.spread]),
  );

  let gamesWithoutOdds = 0;
  const snapshotRows = [];
  for (const game of unstartedGames) {
    const spread = spreadByProviderId.get(game.providerGameId);
    // Missing from the provider response (undefined) or no line yet (null /
    // non-finite) both count as "no odds" — no snapshot, never a games write.
    if (typeof spread === "number" && Number.isFinite(spread)) {
      snapshotRows.push({ gameId: game.id, spread, capturedAt: now, createdAt: now });
    } else {
      gamesWithoutOdds += 1;
    }
  }

  if (snapshotRows.length > 0) {
    await db.insert(oddsSnapshots).values(snapshotRows);
  }

  return {
    seasonYear,
    weekNumber: targetWeek.weekNumber,
    unstartedGames: unstartedGames.length,
    snapshotsInserted: snapshotRows.length,
    gamesWithoutOdds,
  };
}

/**
 * Resolves the week to snapshot from OUR `weeks` table (never the provider):
 * an explicit override, else the week currently in progress
 * (`startsAt <= now < endsAt`), else the next upcoming week (pre-season odds).
 */
async function resolveTargetWeek(
  db: Db,
  seasonId: string,
  now: Date,
  weekNumber?: number,
): Promise<{ id: string; weekNumber: number } | null> {
  const selection = { id: weeks.id, weekNumber: weeks.weekNumber };

  if (weekNumber !== undefined) {
    const [week] = await db
      .select(selection)
      .from(weeks)
      .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)));
    return week ?? null;
  }

  const [current] = await db
    .select(selection)
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), lte(weeks.startsAt, now), gt(weeks.endsAt, now)));
  if (current) {
    return current;
  }

  const [next] = await db
    .select(selection)
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), gt(weeks.startsAt, now)))
    .orderBy(asc(weeks.startsAt))
    .limit(1);
  return next ?? null;
}
