import { isDeepStrictEqual } from "node:util";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, gameStatContext, sportSeasons, teams, teamSeasonStats } from "@picksleagues/db";
import {
  type Clock,
  type GameDataProvider,
  type ProviderTeamSeasonRecord,
  nflSeasonYearFor,
} from "@picksleagues/core";
import {
  GameStatContextPayloadSchema,
  JOB_SKIP_REASON,
  SPORT,
  UNSTARTED_GAME_STATUSES,
  WEEK_TYPE,
  type WeekType,
} from "@picksleagues/schemas";
import { resolveRecurringSyncSeasonYear } from "./season-lifecycle";
import { resolveTargetWeeks } from "./target-weeks";

/**
 * Maintains the matchup-stats tables (ADR-0040): every team's season record
 * for the current season (one bulk provider read), and each unstarted game's
 * matchup context (injuries, FPI, ATS, last five — one provider read per
 * game) across the same anchor-plus-following week window sync-odds prices,
 * resolved by the shared `resolveTargetWeeks` so the two jobs can never
 * target different weeks.
 *
 * While the current season has no completed games, the **prior** season's
 * records are synced too — they are what the read path serves as the week-1
 * fallback, and refreshing them exactly (and only) during the fallback window
 * also heals a prior season whose final weeks this job never saw.
 *
 * Idempotent like its siblings: unchanged rows are skipped, so `updated_at`
 * stays an honest as-of stamp (the UI shows it) and a re-run over unmoved
 * data is a true no-op. Never creates seasons/weeks/games (schedule-sync owns
 * reference data) and writes no `override_*` — these tables have none by
 * design (ADR-0040).
 */
export async function syncNflStats(
  db: Db,
  clock: Clock,
  provider: GameDataProvider,
  opts?: { seasonYear?: number; weekType?: WeekType; weekNumber?: number },
): Promise<Record<string, string | number | boolean>> {
  // One `now` per run: every comparison and every `updated_at` share one
  // instant, reaching SQL as a bound parameter (arch D13).
  const now = clock.now();
  const seasonYear =
    opts?.seasonYear ?? (await resolveRecurringSyncSeasonYear(db, nflSeasonYearFor(now), now));

  const [season] = await db
    .select({ id: sportSeasons.id })
    .from(sportSeasons)
    .where(and(eq(sportSeasons.sport, SPORT.NFL), eq(sportSeasons.year, seasonYear)));
  if (!season) {
    // Sync jobs never create reference data — schedule-sync owns season/week
    // creation (feedback: recurring syncs query reference data, don't upsert it).
    return { skipped: true, reason: JOB_SKIP_REASON.SEASON_NOT_SYNCED };
  }

  // Weeks resolve before anything writes: an explicitly requested week that
  // isn't synced must skip loudly (sync-odds' rule — a backfill of one week
  // must never quietly report "ok" having touched another, or nothing), and
  // a skip after the team-stats write would bury counters the run earned.
  // An explicit week defaults its type to REGULAR — a bare week number is the
  // regular-season case; postseason narrowing must name `weekType`.
  const targetWeeks = await resolveTargetWeeks(
    db,
    season.id,
    now,
    opts?.weekNumber,
    opts?.weekType ?? WEEK_TYPE.REGULAR,
  );
  if (opts?.weekNumber !== undefined && targetWeeks.length === 0) {
    return { skipped: true, reason: JOB_SKIP_REASON.WEEK_NOT_SYNCED };
  }

  const records = await provider.fetchNflTeamSeasonRecords(seasonYear);
  const teamStatsUpdated = await upsertTeamSeasonStats(db, records, now);

  // The fallback window: no team has a completed game yet (an unpublished
  // season's empty response lands here too).
  let priorSeasonTeamStatsUpdated = 0;
  const currentSeasonHasGames = records.some(
    (record) => record.wins + record.losses + record.ties > 0,
  );
  if (!currentSeasonHasGames) {
    const priorRecords = await provider.fetchNflTeamSeasonRecords(seasonYear - 1);
    priorSeasonTeamStatsUpdated = await upsertTeamSeasonStats(db, priorRecords, now);
  }

  let unstartedGames = 0;
  let contextsUpdated = 0;
  let contextsMissing = 0;
  for (const week of targetWeeks) {
    const counts = await refreshWeekGameContexts(db, provider, week.id, now);
    unstartedGames += counts.unstartedGames;
    contextsUpdated += counts.contextsUpdated;
    contextsMissing += counts.contextsMissing;
  }

  // On the *derived* path, a season with no upcoming week (its games all
  // played) still reports `ok` — team stats are season-wide work that already
  // happened, and the week-window counters just read zero. Only an explicit
  // week miss skips (above), matching sync-odds.
  return {
    seasonYear,
    teamStatsUpdated,
    priorSeasonTeamStatsUpdated,
    weeksTargeted: targetWeeks.length,
    unstartedGames,
    contextsUpdated,
    contextsMissing,
  };
}

/**
 * Upserts one season's team records, skipping rows whose stored facts already
 * match — the skip is what keeps `updated_at` an as-of stamp rather than a
 * last-run stamp. Returns the number of rows actually written.
 */
async function upsertTeamSeasonStats(
  db: Db,
  records: ProviderTeamSeasonRecord[],
  now: Date,
): Promise<number> {
  if (records.length === 0) return 0;

  const [seasonYear] = new Set(records.map((record) => record.seasonYear));
  const nflTeams = await db
    .select({ id: teams.id, providerTeamId: teams.providerTeamId })
    .from(teams)
    .where(eq(teams.sport, SPORT.NFL));
  const teamIdByProviderId = new Map(
    nflTeams
      .filter((team) => team.providerTeamId !== null)
      .map((team) => [team.providerTeamId!, team.id]),
  );

  const existingRows = await db
    .select()
    .from(teamSeasonStats)
    .where(eq(teamSeasonStats.seasonYear, seasonYear!));
  const existingByTeamId = new Map(existingRows.map((row) => [row.teamId, row]));

  let written = 0;
  for (const record of records) {
    // A provider team we haven't synced is not reference data this job may
    // create (ADR-0010: schedule-sync owns teams) — skipped, healed by the
    // next run after a schedule sync lands it.
    const teamId = teamIdByProviderId.get(record.providerTeamId);
    if (!teamId) continue;

    const values = {
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      homeWins: record.homeWins,
      homeLosses: record.homeLosses,
      homeTies: record.homeTies,
      roadWins: record.roadWins,
      roadLosses: record.roadLosses,
      roadTies: record.roadTies,
      streak: record.streak,
      pointsFor: record.pointsFor,
      pointsAgainst: record.pointsAgainst,
    };

    const existing = existingByTeamId.get(teamId);
    if (
      existing &&
      Object.entries(values).every(([key, value]) => existing[key as keyof typeof values] === value)
    ) {
      continue;
    }

    await db
      .insert(teamSeasonStats)
      .values({ teamId, seasonYear: record.seasonYear, ...values, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [teamSeasonStats.teamId, teamSeasonStats.seasonYear],
        set: { ...values, updatedAt: now },
      });
    written += 1;
  }
  return written;
}

/** Refreshes matchup context for one week's unstarted games, reporting what it touched. */
async function refreshWeekGameContexts(
  db: Db,
  provider: GameDataProvider,
  weekId: string,
  now: Date,
): Promise<{ unstartedGames: number; contextsUpdated: number; contextsMissing: number }> {
  // Unstarted only, the same filter sync-odds prices by: context is pregame
  // decision data, and a kicked-off game keeps whatever was last synced — a
  // sheet opened mid-game shows the pregame report with its honest as-of stamp.
  const unstartedGames = await db
    .select({ id: games.id, providerGameId: games.providerGameId })
    .from(games)
    .where(
      and(
        eq(games.weekId, weekId),
        gt(games.kickoffAt, now),
        inArray(games.status, [...UNSTARTED_GAME_STATUSES]),
      ),
    );

  if (unstartedGames.length === 0) {
    return { unstartedGames: 0, contextsUpdated: 0, contextsMissing: 0 };
  }

  const existingRows = await db
    .select()
    .from(gameStatContext)
    .where(
      inArray(
        gameStatContext.gameId,
        unstartedGames.map((game) => game.id),
      ),
    );
  const existingByGameId = new Map(existingRows.map((row) => [row.gameId, row]));

  let contextsUpdated = 0;
  let contextsMissing = 0;
  for (const game of unstartedGames) {
    // Network read outside any transaction (engineering rules: never hold a
    // transaction open across a network call).
    const context = await provider.fetchNflGameStatContext(game.providerGameId);
    if (!context) {
      contextsMissing += 1;
      continue;
    }
    // Parsed (not just cast) so a provider-shaped bug lands here as a loud
    // sync failure, never as an unparseable stored payload a read trips over.
    const payload = GameStatContextPayloadSchema.parse({
      home: context.home,
      away: context.away,
    });

    const existing = existingByGameId.get(game.id);
    // Deep equality, never a stringify compare — jsonb round-trips with its
    // own key order, and an order-sensitive compare would rewrite (and
    // restamp) every row every run.
    if (existing && isDeepStrictEqual(existing.payload, payload)) {
      continue;
    }

    await db
      .insert(gameStatContext)
      .values({ gameId: game.id, payload, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: gameStatContext.gameId,
        set: { payload, updatedAt: now },
      });
    contextsUpdated += 1;
  }

  return { unstartedGames: unstartedGames.length, contextsUpdated, contextsMissing };
}
