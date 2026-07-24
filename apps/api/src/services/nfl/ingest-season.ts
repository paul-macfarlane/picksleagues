import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons, teams, weeks } from "@picksleagues/db";
import type { ProviderGame, ProviderWeek } from "@picksleagues/core";
import { GAME_STATUS, SPORT, type WeekType } from "@picksleagues/schemas";
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

export type SeasonSnapshotResult = {
  seasonId: string;
  weeksSynced: number;
  weeksDeleted: number;
  teamsCreated: number;
  gamesCreated: number;
  gamesUpdated: number;
  postponements: number;
  cancellations: number;
  weekMoves: number;
  kickoffChanges: number;
};

/**
 * Upserts one season's structure + games into our tables — the shared write
 * path behind both the normal per-run sync (`sync-schedule.ts`) and the
 * offseason "ensure next season exists" step (ADR-0009), so both write
 * through the identical diff/idempotency logic. `opts.provisional` controls
 * the season row's flag: `false` (the normal-sync default) clears an existing
 * provisional flag in place the moment real data lands, never re-forking the
 * row; `true` marks a fabricated estimate. Must run inside a transaction
 * (`tx` satisfies `Db`).
 */
export async function ingestSeasonSnapshot(
  tx: Db,
  now: Date,
  seasonYear: number,
  structureWeeks: ProviderWeek[],
  providerGames: ProviderGame[],
  opts?: { provisional?: boolean },
): Promise<SeasonSnapshotResult> {
  const wantProvisional = opts?.provisional ?? false;

  const [existingSeason] = await tx
    .select({ id: sportSeasons.id, provisional: sportSeasons.provisional })
    .from(sportSeasons)
    .where(and(eq(sportSeasons.sport, SPORT.NFL), eq(sportSeasons.year, seasonYear)));

  let seasonId: string;
  if (existingSeason) {
    seasonId = existingSeason.id;
    // Real data landing clears an existing provisional estimate in place
    // (ADR-0009: "provisional rows are overwritten in place by real
    // ingestion") — never touched otherwise, so a no-op re-run of either
    // kind leaves the row byte-identical.
    if (!wantProvisional && existingSeason.provisional) {
      await tx
        .update(sportSeasons)
        .set({ provisional: false, updatedAt: now })
        .where(eq(sportSeasons.id, seasonId));
    }
  } else {
    const [inserted] = await tx
      .insert(sportSeasons)
      .values({
        sport: SPORT.NFL,
        year: seasonYear,
        provisional: wantProvisional,
        createdAt: now,
        updatedAt: now,
      })
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
  // week numbers overlap. The same diff corrects a provisional season's
  // estimated rows in place once the real structure lands.
  const existingWeeks = await tx.select().from(weeks).where(eq(weeks.seasonId, seasonId));
  const existingWeekByKey = new Map(
    existingWeeks.map((week) => [weekKey(week.weekType, week.weekNumber), week]),
  );
  const weekIdByKey = new Map<string, string>();

  for (const week of structureWeeks) {
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

  // Convergence sweep — runs *after* the games upsert above so any week-move
  // repointing has already vacated the weeks it left. Deletes this season's
  // weeks the current structure no longer publishes AND that hold zero games,
  // converging two kinds of stale rows to exactly what a from-scratch ingest of
  // this structure would produce: (1) provisional-era estimated weeks the real
  // structure drops (e.g. a regular-only publish superseding an estimated
  // postseason), and (2) legacy pre-normalization rows (a Super Bowl stored
  // under the old ESPN number 5 before the adapter renumbered it to the domain
  // 4). The zero-game guard means a week that still owns data is never touched.
  // Guarded on a non-empty structure: an empty structure is the "nothing
  // published yet" case (ADR-0009), never "everything was deleted".
  let weeksDeleted = 0;
  if (structureWeeks.length > 0) {
    const orphanWeekIds = existingWeeks
      .filter((week) => !weekIdByKey.has(weekKey(week.weekType, week.weekNumber)))
      .map((week) => week.id);
    if (orphanWeekIds.length > 0) {
      const weeksStillHoldingGames = await tx
        .selectDistinct({ weekId: games.weekId })
        .from(games)
        .where(inArray(games.weekId, orphanWeekIds));
      const weekIdsWithGames = new Set(weeksStillHoldingGames.map((row) => row.weekId));
      const deletableWeekIds = orphanWeekIds.filter((id) => !weekIdsWithGames.has(id));
      if (deletableWeekIds.length > 0) {
        const deleted = await tx
          .delete(weeks)
          .where(inArray(weeks.id, deletableWeekIds))
          .returning({ id: weeks.id });
        weeksDeleted = deleted.length;
      }
    }
  }

  return {
    seasonId,
    weeksSynced: weekIdByKey.size,
    weeksDeleted,
    teamsCreated,
    gamesCreated,
    gamesUpdated,
    postponements,
    cancellations,
    weekMoves,
    kickoffChanges,
  };
}
