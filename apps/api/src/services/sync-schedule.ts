import { inArray, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons, weeks } from "@picksleagues/db";
import { type Clock, type GameDataProvider, nflSeasonYearFor } from "@picksleagues/core";
import { GAME_STATUS, SPORT } from "@picksleagues/schemas";
import { logInfo } from "../lib/logger";

/**
 * Ingests the NFL regular-season schedule from the provider into our own
 * tables (arch §External Data — request paths never call the provider; jobs
 * sync, reads serve our tables). Idempotent (engineering rules §Jobs): re-runs
 * with identical provider data leave every row byte-identical, so a missed or
 * double-fired tick is harmless.
 *
 * Load-bearing invariant (arch D15): this only ever writes provider-synced
 * fields — never any `override_*` column, never `overriddenBy/At`. A re-sync
 * can never clobber an admin correction; reads/settlement resolve
 * `override_* ?? provider_*` elsewhere.
 */
export async function syncSchedule(
  db: Db,
  clock: Clock,
  provider: GameDataProvider,
  opts?: { seasonYear?: number; weekNumber?: number },
): Promise<Record<string, string | number | boolean>> {
  const seasonYear = opts?.seasonYear ?? nflSeasonYearFor(clock.now());

  // Fetch phase: all network I/O happens here, before opening the transaction
  // (engineering rules: never hold a transaction open across a network call).
  const structure = await provider.fetchSeasonStructure(seasonYear);
  const weekNumbersToFetch =
    opts?.weekNumber !== undefined
      ? [opts.weekNumber]
      : structure.weeks.map((week) => week.weekNumber);
  const fetchedGamesPerWeek = await Promise.all(
    weekNumbersToFetch.map((weekNumber) => provider.fetchWeekGames(seasonYear, weekNumber)),
  );
  const providerGames = fetchedGamesPerWeek.flat();

  // One `now` per run so every row this job stamps shares one instant, and it
  // reaches SQL as a bound parameter (arch D13) — never SQL now().
  const now = clock.now();

  return db.transaction(async (tx) => {
    const [season] = await tx
      .insert(sportSeasons)
      .values({ sport: SPORT.NFL, year: seasonYear, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [sportSeasons.sport, sportSeasons.year],
        set: { updatedAt: now },
      })
      .returning({ id: sportSeasons.id });
    if (!season) {
      throw new Error(`syncSchedule: sport_seasons upsert returned no row for NFL ${seasonYear}`);
    }

    const upsertedWeeks = await tx
      .insert(weeks)
      .values(
        structure.weeks.map((week) => ({
          seasonId: season.id,
          weekNumber: week.weekNumber,
          startsAt: week.startsAt,
          endsAt: week.endsAt,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [weeks.seasonId, weeks.weekNumber],
        set: {
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          updatedAt: now,
        },
      })
      .returning({ id: weeks.id, weekNumber: weeks.weekNumber });
    const weekIdByNumber = new Map(upsertedWeeks.map((week) => [week.weekNumber, week.id]));

    let gamesCreated = 0;
    let gamesUpdated = 0;
    let postponements = 0;
    let cancellations = 0;
    let weekMoves = 0;
    let kickoffChanges = 0;

    if (providerGames.length > 0) {
      const providerGameIds = providerGames.map((game) => game.providerGameId);
      // Diff-load the existing rows first (the stated exception to the pure
      // onConflictDoUpdate path) so transitions can be detected before the write.
      const existingRows = await tx
        .select()
        .from(games)
        .where(inArray(games.providerGameId, providerGameIds));
      const existingByProviderId = new Map(
        existingRows.map((row) => [row.providerGameId, row]),
      );

      const gameValues = providerGames.map((game) => {
        const weekId = weekIdByNumber.get(game.weekNumber);
        if (!weekId) {
          throw new Error(
            `syncSchedule: no week row for week ${game.weekNumber} (game ${game.providerGameId})`,
          );
        }

        const existing = existingByProviderId.get(game.providerGameId);
        if (!existing) {
          gamesCreated += 1;
        } else {
          gamesUpdated += 1;
          if (existing.status !== GAME_STATUS.POSTPONED && game.status === GAME_STATUS.POSTPONED) {
            postponements += 1;
            logInfo("sync-schedule.postponed", { providerGameId: game.providerGameId });
          }
          if (existing.status !== GAME_STATUS.CANCELLED && game.status === GAME_STATUS.CANCELLED) {
            cancellations += 1;
            logInfo("sync-schedule.cancelled", { providerGameId: game.providerGameId });
          }
          if (existing.weekId !== weekId) {
            weekMoves += 1;
            logInfo("sync-schedule.week-move", { providerGameId: game.providerGameId });
          }
          if (existing.kickoffAt.getTime() !== game.kickoffAt.getTime()) {
            kickoffChanges += 1;
            logInfo("sync-schedule.kickoff-change", { providerGameId: game.providerGameId });
          }
        }

        return {
          weekId,
          providerGameId: game.providerGameId,
          homeTeamAbbr: game.homeTeamAbbr,
          homeTeamName: game.homeTeamName,
          awayTeamAbbr: game.awayTeamAbbr,
          awayTeamName: game.awayTeamName,
          kickoffAt: game.kickoffAt,
          status: game.status,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          createdAt: now,
          updatedAt: now,
        };
      });

      await tx
        .insert(games)
        .values(gameValues)
        .onConflictDoUpdate({
          target: games.providerGameId,
          // Provider fields only — every override_* column is deliberately
          // absent (arch D15). Scores are included so a game can never sit at
          // status=final with null scores between job cadences.
          set: {
            weekId: sql`excluded.week_id`,
            kickoffAt: sql`excluded.kickoff_at`,
            status: sql`excluded.status`,
            homeTeamAbbr: sql`excluded.home_team_abbr`,
            homeTeamName: sql`excluded.home_team_name`,
            awayTeamAbbr: sql`excluded.away_team_abbr`,
            awayTeamName: sql`excluded.away_team_name`,
            homeScore: sql`excluded.home_score`,
            awayScore: sql`excluded.away_score`,
            updatedAt: now,
          },
        });
    }

    return {
      seasonYear,
      weeksUpserted: upsertedWeeks.length,
      gamesCreated,
      gamesUpdated,
      postponements,
      cancellations,
      weekMoves,
      kickoffChanges,
    };
  });
}
