import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons, teams, weeks } from "@picksleagues/db";
import {
  type Clock,
  type GameDataProvider,
  type ProviderGame,
  nflSeasonYearFor,
} from "@picksleagues/core";
import { GAME_STATUS, SPORT, WEEK_TYPE, type WeekType } from "@picksleagues/schemas";
import { logInfo } from "../../lib/logger";

/** Composite key: regular and postseason week numbers overlap (both restart at 1). */
function weekKey(weekType: WeekType, weekNumber: number): string {
  return `${weekType}:${weekNumber}`;
}

type ProviderTeam = { providerTeamId: string; abbreviation: string; name: string };

/**
 * Upserts the teams referenced by this batch of provider games (arch ADR-0010):
 * schedule-sync owns reference-data creation the same way it owns
 * seasons/weeks — recurring syncs only ever read `teams` (feedback: recurring
 * syncs query reference data, don't upsert it).
 *
 * Two-key match: `(sport, providerTeamId)` is the real identity once a team
 * has synced; a miss there falls back to `(sport, abbreviation)` against a
 * not-yet-provider-linked row (the pre-provider-id bootstrap/backfill case)
 * and fills its `providerTeamId`. A miss on both inserts a new row. A provider
 * rename (name/abbreviation drift on an already-linked row) updates in place —
 * never forks a second row for the same provider id.
 */
async function upsertTeams(
  tx: Db,
  now: Date,
  providerGames: ProviderGame[],
): Promise<{ teamIdByProviderTeamId: Map<string, string>; teamsCreated: number }> {
  const providerTeamsById = new Map<string, ProviderTeam>();
  for (const game of providerGames) {
    providerTeamsById.set(game.homeTeamProviderId, {
      providerTeamId: game.homeTeamProviderId,
      abbreviation: game.homeTeamAbbr,
      name: game.homeTeamName,
    });
    providerTeamsById.set(game.awayTeamProviderId, {
      providerTeamId: game.awayTeamProviderId,
      abbreviation: game.awayTeamAbbr,
      name: game.awayTeamName,
    });
  }
  const providerTeams = [...providerTeamsById.values()];

  const teamIdByProviderTeamId = new Map<string, string>();
  let teamsCreated = 0;
  if (providerTeams.length === 0) {
    return { teamIdByProviderTeamId, teamsCreated };
  }

  const providerTeamIds = providerTeams.map((team) => team.providerTeamId);
  const existingByProviderId = await tx
    .select()
    .from(teams)
    .where(and(eq(teams.sport, SPORT.NFL), inArray(teams.providerTeamId, providerTeamIds)));
  const existingByProviderIdMap = new Map(
    existingByProviderId.map((team) => [team.providerTeamId as string, team]),
  );

  const bootstrapAbbrs = providerTeams
    .filter((team) => !existingByProviderIdMap.has(team.providerTeamId))
    .map((team) => team.abbreviation);
  const existingByAbbr =
    bootstrapAbbrs.length > 0
      ? await tx
          .select()
          .from(teams)
          .where(
            and(
              eq(teams.sport, SPORT.NFL),
              inArray(teams.abbreviation, bootstrapAbbrs),
              isNull(teams.providerTeamId),
            ),
          )
      : [];
  const existingByAbbrMap = new Map(existingByAbbr.map((team) => [team.abbreviation, team]));

  const newTeamValues: (typeof teams.$inferInsert)[] = [];

  for (const providerTeam of providerTeams) {
    const linked = existingByProviderIdMap.get(providerTeam.providerTeamId);
    if (linked) {
      teamIdByProviderTeamId.set(providerTeam.providerTeamId, linked.id);
      const renamed =
        linked.name !== providerTeam.name || linked.abbreviation !== providerTeam.abbreviation;
      if (renamed) {
        await tx
          .update(teams)
          .set({ name: providerTeam.name, abbreviation: providerTeam.abbreviation, updatedAt: now })
          .where(eq(teams.id, linked.id));
      }
      continue;
    }

    const bootstrapped = existingByAbbrMap.get(providerTeam.abbreviation);
    if (bootstrapped) {
      teamIdByProviderTeamId.set(providerTeam.providerTeamId, bootstrapped.id);
      await tx
        .update(teams)
        .set({
          providerTeamId: providerTeam.providerTeamId,
          name: providerTeam.name,
          abbreviation: providerTeam.abbreviation,
          updatedAt: now,
        })
        .where(eq(teams.id, bootstrapped.id));
      continue;
    }

    newTeamValues.push({
      sport: SPORT.NFL,
      providerTeamId: providerTeam.providerTeamId,
      abbreviation: providerTeam.abbreviation,
      name: providerTeam.name,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (newTeamValues.length > 0) {
    // DoNothing (not DoUpdate): a concurrent run winning the insert race wrote
    // the same provider data — converge silently rather than abort (arch D7).
    const inserted = await tx
      .insert(teams)
      .values(newTeamValues)
      .onConflictDoNothing({ target: [teams.sport, teams.providerTeamId] })
      .returning({ id: teams.id, providerTeamId: teams.providerTeamId });
    teamsCreated = inserted.length;
    for (const row of inserted) {
      if (row.providerTeamId) teamIdByProviderTeamId.set(row.providerTeamId, row.id);
    }
  }

  return { teamIdByProviderTeamId, teamsCreated };
}

/**
 * Ingests the NFL schedule — regular season and postseason — from the provider
 * into our own tables (arch §External Data — request paths never call the
 * provider; jobs sync, reads serve our tables). Idempotent (engineering rules
 * §Jobs): re-runs with identical provider data leave every row byte-identical,
 * so a missed or double-fired tick is harmless.
 *
 * Load-bearing invariant (arch D15): this only ever writes provider-synced
 * fields — never any `override_*` column, never `overriddenBy/At`. A re-sync
 * can never clobber an admin correction; reads/settlement resolve
 * `override_* ?? provider_*` elsewhere.
 */
export async function syncNflSchedule(
  db: Db,
  clock: Clock,
  provider: GameDataProvider,
  opts?: { seasonYear?: number; weekType?: WeekType; weekNumber?: number },
): Promise<Record<string, string | number | boolean>> {
  // One `now` per run: season derivation and every row timestamp share one
  // instant, reaching SQL as a bound parameter (arch D13) — never SQL now().
  const now = clock.now();
  const seasonYear = opts?.seasonYear ?? nflSeasonYearFor(now);

  // Fetch phase: all network I/O happens here, before opening the transaction
  // (engineering rules: never hold a transaction open across a network call).
  const structure = await provider.fetchNflSeasonStructure(seasonYear);
  // An explicit week number defaults its type to REGULAR — a bare `?week=` is
  // the regular-season case; postseason narrowing must name `?weekType=`.
  const weeksToFetch =
    opts?.weekNumber !== undefined
      ? [{ weekType: opts.weekType ?? WEEK_TYPE.REGULAR, weekNumber: opts.weekNumber }]
      : structure.weeks.map((week) => ({ weekType: week.weekType, weekNumber: week.weekNumber }));
  // An explicit week the structure doesn't expose (the excluded Pro Bowl week,
  // or a number out of range) skips like the sibling jobs instead of fetching
  // games we'd have no week row for and 500ing the run.
  if (
    opts?.weekNumber !== undefined &&
    !structure.weeks.some(
      (week) => week.weekType === weeksToFetch[0]?.weekType && week.weekNumber === opts.weekNumber,
    )
  ) {
    return { seasonYear, skipped: true, reason: "week_not_synced" };
  }
  const fetchedGamesPerWeek = await Promise.all(
    weeksToFetch.map((week) =>
      provider.fetchNflWeekGames(seasonYear, week.weekType, week.weekNumber),
    ),
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
        throw new Error(
          `syncNflSchedule: sport_seasons insert returned no row for NFL ${seasonYear}`,
        );
      }
      seasonId = inserted.id;
    }

    // Diff weeks: insert new ones, UPDATE only those whose window or label
    // actually moved, leave unchanged weeks untouched (no updatedAt churn on a
    // no-op re-run). Keyed by (weekType, weekNumber) — regular and postseason
    // week numbers overlap.
    const existingWeeks = await tx.select().from(weeks).where(eq(weeks.seasonId, seasonId));
    const existingWeekByKey = new Map(
      existingWeeks.map((week) => [weekKey(week.weekType, week.weekNumber), week]),
    );
    const weekIdByKey = new Map<string, string>();

    for (const week of structure.weeks) {
      const key = weekKey(week.weekType, week.weekNumber);
      const existing = existingWeekByKey.get(key);
      if (!existing) {
        const [inserted] = await tx
          .insert(weeks)
          .values({
            seasonId,
            weekType: week.weekType,
            weekNumber: week.weekNumber,
            label: week.label,
            startsAt: week.startsAt,
            endsAt: week.endsAt,
            createdAt: now,
            updatedAt: now,
          })
          // Same rationale as the season insert: survive a concurrent
          // first-insert (overlapping cron + manual trigger) and still return
          // the row's id, keeping "safe to double-trigger" (arch D7).
          .onConflictDoUpdate({
            target: [weeks.seasonId, weeks.weekType, weeks.weekNumber],
            set: { updatedAt: now },
          })
          .returning({ id: weeks.id });
        if (!inserted) {
          throw new Error(`syncNflSchedule: weeks insert returned no row for week ${key}`);
        }
        weekIdByKey.set(key, inserted.id);
        continue;
      }

      weekIdByKey.set(key, existing.id);
      const weekChanged =
        existing.startsAt.getTime() !== week.startsAt.getTime() ||
        existing.endsAt.getTime() !== week.endsAt.getTime() ||
        existing.label !== week.label;
      if (weekChanged) {
        await tx
          .update(weeks)
          .set({ startsAt: week.startsAt, endsAt: week.endsAt, label: week.label, updatedAt: now })
          .where(eq(weeks.id, existing.id));
      }
    }

    let gamesCreated = 0;
    let gamesUpdated = 0;
    let postponements = 0;
    let cancellations = 0;
    let weekMoves = 0;
    let kickoffChanges = 0;

    // Teams are upserted before games so every game's FKs resolve against a
    // row that exists in this same transaction (arch ADR-0010).
    const { teamIdByProviderTeamId, teamsCreated } = await upsertTeams(tx, now, providerGames);

    if (providerGames.length > 0) {
      const providerGameIds = providerGames.map((game) => game.providerGameId);
      // Load existing rows first so we can diff provider-owned fields and write
      // only what actually changed (matches sync-scores; no updatedAt churn).
      const existingRows = await tx
        .select()
        .from(games)
        .where(inArray(games.providerGameId, providerGameIds));
      const existingByProviderId = new Map(existingRows.map((row) => [row.providerGameId, row]));

      const newGameValues: (typeof games.$inferInsert)[] = [];

      for (const game of providerGames) {
        const weekId = weekIdByKey.get(weekKey(game.weekType, game.weekNumber));
        if (!weekId) {
          throw new Error(
            `syncNflSchedule: no week row for ${weekKey(game.weekType, game.weekNumber)} (game ${game.providerGameId})`,
          );
        }

        const homeTeamId = teamIdByProviderTeamId.get(game.homeTeamProviderId);
        const awayTeamId = teamIdByProviderTeamId.get(game.awayTeamProviderId);
        if (!homeTeamId || !awayTeamId) {
          throw new Error(
            `syncNflSchedule: team not resolved for game ${game.providerGameId} (home ${game.homeTeamProviderId}, away ${game.awayTeamProviderId})`,
          );
        }

        // Provider fields only — every override_* column is deliberately absent
        // (arch D15). Scores are included so a game can never sit at status=final
        // with null scores between job cadences.
        const providerFields = {
          weekId,
          kickoffAt: game.kickoffAt,
          status: game.status,
          homeTeamId,
          awayTeamId,
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
          logInfo("nfl-sync-schedule.postponed", { providerGameId: game.providerGameId });
        }
        if (existing.status !== GAME_STATUS.CANCELLED && game.status === GAME_STATUS.CANCELLED) {
          cancellations += 1;
          logInfo("nfl-sync-schedule.cancelled", { providerGameId: game.providerGameId });
        }
        if (existing.weekId !== weekId) {
          weekMoves += 1;
          logInfo("nfl-sync-schedule.week-move", { providerGameId: game.providerGameId });
        }
        if (existing.kickoffAt.getTime() !== game.kickoffAt.getTime()) {
          kickoffChanges += 1;
          logInfo("nfl-sync-schedule.kickoff-change", { providerGameId: game.providerGameId });
        }

        const changed =
          existing.weekId !== weekId ||
          existing.kickoffAt.getTime() !== game.kickoffAt.getTime() ||
          existing.status !== game.status ||
          existing.homeTeamId !== homeTeamId ||
          existing.awayTeamId !== awayTeamId ||
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
      weeksSynced: weekIdByKey.size,
      teamsCreated,
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
