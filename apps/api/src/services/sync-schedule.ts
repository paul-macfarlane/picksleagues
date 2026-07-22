import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons, weeks } from "@picksleagues/db";
import {
  type Clock,
  type GameDataProvider,
  type ProviderGame,
  nflSeasonYearFor,
} from "@picksleagues/core";
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
  // One `now` per run: season derivation and every row timestamp share one
  // instant, reaching SQL as a bound parameter (arch D13) — never SQL now().
  const now = clock.now();
  const seasonYear = opts?.seasonYear ?? nflSeasonYearFor(now);

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

  // Dedupe by providerGameId before the write: ESPN transiently lists a
  // rescheduled game under both its old and new week, so the flat concat can
  // carry the same id twice. A multi-row INSERT ... ON CONFLICT DO UPDATE that
  // hits the same row twice throws Postgres "cannot affect row a second time"
  // and aborts the whole run — so collapse to last-wins (the later week's copy).
  const dedupedByProviderId = new Map<string, ProviderGame>();
  let duplicateProviderGames = 0;
  for (const game of fetchedGamesPerWeek.flat()) {
    if (dedupedByProviderId.has(game.providerGameId)) {
      duplicateProviderGames += 1;
    }
    dedupedByProviderId.set(game.providerGameId, game);
  }
  const providerGames = [...dedupedByProviderId.values()];

  return db.transaction(async (tx) => {
    const [existingSeason] = await tx
      .select({ id: sportSeasons.id })
      .from(sportSeasons)
      .where(and(eq(sportSeasons.sport, SPORT.NFL), eq(sportSeasons.year, seasonYear)));

    let seasonId: string;
    if (existingSeason) {
      // Nothing on the season row changes across syncs — skip the update-touch
      // so a no-op re-run leaves it byte-identical.
      seasonId = existingSeason.id;
    } else {
      const [inserted] = await tx
        .insert(sportSeasons)
        .values({ sport: SPORT.NFL, year: seasonYear, createdAt: now, updatedAt: now })
        // onConflictDoUpdate (not DoNothing) only to survive a rare concurrent
        // first-insert and still return the row's id.
        .onConflictDoUpdate({
          target: [sportSeasons.sport, sportSeasons.year],
          set: { updatedAt: now },
        })
        .returning({ id: sportSeasons.id });
      if (!inserted) {
        throw new Error(`syncSchedule: sport_seasons insert returned no row for NFL ${seasonYear}`);
      }
      seasonId = inserted.id;
    }

    // Diff weeks: insert new ones, UPDATE only those whose window actually moved,
    // leave unchanged weeks untouched (no updatedAt churn on a no-op re-run).
    const existingWeeks = await tx.select().from(weeks).where(eq(weeks.seasonId, seasonId));
    const existingWeekByNumber = new Map(existingWeeks.map((week) => [week.weekNumber, week]));
    const weekIdByNumber = new Map<number, string>();

    for (const week of structure.weeks) {
      const existing = existingWeekByNumber.get(week.weekNumber);
      if (!existing) {
        const [inserted] = await tx
          .insert(weeks)
          .values({
            seasonId,
            weekNumber: week.weekNumber,
            startsAt: week.startsAt,
            endsAt: week.endsAt,
            createdAt: now,
            updatedAt: now,
          })
          // Same rationale as the season insert: survive a concurrent
          // first-insert (overlapping cron + manual trigger) and still return
          // the row's id, keeping "safe to double-trigger" (arch D7).
          .onConflictDoUpdate({
            target: [weeks.seasonId, weeks.weekNumber],
            set: { updatedAt: now },
          })
          .returning({ id: weeks.id });
        if (!inserted) {
          throw new Error(`syncSchedule: weeks insert returned no row for week ${week.weekNumber}`);
        }
        weekIdByNumber.set(week.weekNumber, inserted.id);
        continue;
      }

      weekIdByNumber.set(week.weekNumber, existing.id);
      const windowChanged =
        existing.startsAt.getTime() !== week.startsAt.getTime() ||
        existing.endsAt.getTime() !== week.endsAt.getTime();
      if (windowChanged) {
        await tx
          .update(weeks)
          .set({ startsAt: week.startsAt, endsAt: week.endsAt, updatedAt: now })
          .where(eq(weeks.id, existing.id));
      }
    }

    let gamesCreated = 0;
    let gamesUpdated = 0;
    let postponements = 0;
    let cancellations = 0;
    let weekMoves = 0;
    let kickoffChanges = 0;

    if (providerGames.length > 0) {
      const providerGameIds = providerGames.map((game) => game.providerGameId);
      // Load existing rows first so we can diff provider-owned fields and write
      // only what actually changed (matches sync-scores; no updatedAt churn).
      const existingRows = await tx
        .select()
        .from(games)
        .where(inArray(games.providerGameId, providerGameIds));
      const existingByProviderId = new Map(
        existingRows.map((row) => [row.providerGameId, row]),
      );

      const newGameValues: (typeof games.$inferInsert)[] = [];

      for (const game of providerGames) {
        const weekId = weekIdByNumber.get(game.weekNumber);
        if (!weekId) {
          throw new Error(
            `syncSchedule: no week row for week ${game.weekNumber} (game ${game.providerGameId})`,
          );
        }

        // Provider fields only — every override_* column is deliberately absent
        // (arch D15). Scores are included so a game can never sit at status=final
        // with null scores between job cadences.
        const providerFields = {
          weekId,
          kickoffAt: game.kickoffAt,
          status: game.status,
          homeTeamAbbr: game.homeTeamAbbr,
          homeTeamName: game.homeTeamName,
          awayTeamAbbr: game.awayTeamAbbr,
          awayTeamName: game.awayTeamName,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        };

        const existing = existingByProviderId.get(game.providerGameId);
        if (!existing) {
          newGameValues.push({
            providerGameId: game.providerGameId,
            ...providerFields,
            createdAt: now,
            updatedAt: now,
          });
          continue;
        }

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

        const changed =
          existing.weekId !== weekId ||
          existing.kickoffAt.getTime() !== game.kickoffAt.getTime() ||
          existing.status !== game.status ||
          existing.homeTeamAbbr !== game.homeTeamAbbr ||
          existing.homeTeamName !== game.homeTeamName ||
          existing.awayTeamAbbr !== game.awayTeamAbbr ||
          existing.awayTeamName !== game.awayTeamName ||
          existing.homeScore !== game.homeScore ||
          existing.awayScore !== game.awayScore;
        if (!changed) continue;

        await tx
          .update(games)
          .set({ ...providerFields, updatedAt: now })
          .where(eq(games.id, existing.id));
        gamesUpdated += 1;
      }

      if (newGameValues.length > 0) {
        // DoNothing (not DoUpdate): if a concurrent run won the insert race it
        // wrote the same provider data — converging silently beats aborting the
        // run ("safe to double-trigger", arch D7). Count what we actually wrote.
        const inserted = await tx
          .insert(games)
          .values(newGameValues)
          .onConflictDoNothing({ target: games.providerGameId })
          .returning({ id: games.id });
        gamesCreated = inserted.length;
      }
    }

    return {
      seasonYear,
      weeksSynced: weekIdByNumber.size,
      gamesCreated,
      gamesUpdated,
      duplicateProviderGames,
      postponements,
      cancellations,
      weekMoves,
      kickoffChanges,
    };
  });
}
