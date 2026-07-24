import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { sportSeasons, weeks } from "@picksleagues/db";
import {
  type Clock,
  type GameDataProvider,
  type ProviderGame,
  type ProviderTeam,
  estimatedNflWeeks,
  nflSeasonYearFor,
} from "@picksleagues/core";
import { SPORT, WEEK_TYPE, type WeekType } from "@picksleagues/schemas";
import { ingestSeasonSnapshot } from "./ingest-season";

const UPCOMING_STATUS = {
  REAL: "real",
  PROVISIONAL: "provisional",
  SKIPPED_NOT_CONCLUDED: "skipped_not_concluded",
  SKIPPED_NO_WEEKS: "skipped_no_weeks",
} as const;

/**
 * Offseason lifecycle (ADR-0009 "upcoming seasons exist before their data"):
 * once the default season's ingested weeks show it's concluded, ensures
 * `seasonYear + 1` exists — real data if the provider has published it,
 * otherwise a provisional estimate — so league creation never runs into a
 * dead offseason window. Only called for the bare no-arg trigger (the daily
 * cron shape); explicit `?season=`/`?week=` runs stay surgical and never
 * reach here. Never writes games for a provisional target: `leagueStartAt`
 * must keep deriving null until real kickoffs land. `providerTeams` is the
 * listing the caller already fetched this run — forwarded rather than
 * re-fetched so one job run hits the teams-listing endpoint at most once.
 */
async function ensureUpcomingNflSeason(
  db: Db,
  clock: Clock,
  provider: GameDataProvider,
  defaultSeasonYear: number,
  providerTeams: ProviderTeam[],
): Promise<{ upcoming: string; upcomingSeasonYear: number }> {
  const now = clock.now();
  const upcomingSeasonYear = defaultSeasonYear + 1;

  // One query, from our own tables (arch §External Data never reads the
  // provider on a request/decision path): the default season's furthest week
  // boundary. Raw SQL `max()` skips drizzle's decoder, so map it back to Date.
  const maxWeekEndsAt = sql<string | null>`max(${weeks.endsAt})`.mapWith((value): Date | null =>
    value === null ? null : new Date(value as string),
  );
  const [row] = await db
    .select({ maxEndsAt: maxWeekEndsAt })
    .from(weeks)
    .innerJoin(sportSeasons, eq(sportSeasons.id, weeks.seasonId))
    .where(and(eq(sportSeasons.sport, SPORT.NFL), eq(sportSeasons.year, defaultSeasonYear)));

  // No weeks at all (fresh env, nothing synced yet) — skip rather than assume
  // "concluded" off an empty aggregate.
  if (!row?.maxEndsAt) {
    return { upcoming: UPCOMING_STATUS.SKIPPED_NO_WEEKS, upcomingSeasonYear };
  }
  // Boundary: the last week ending exactly at `now` counts as concluded.
  if (row.maxEndsAt.getTime() > now.getTime()) {
    return { upcoming: UPCOMING_STATUS.SKIPPED_NOT_CONCLUDED, upcomingSeasonYear };
  }

  // Fetch phase before any transaction (never hold one open across a network
  // call): ask the provider whether next year's structure is out yet.
  const structure = await provider.fetchNflSeasonStructure(upcomingSeasonYear);

  if (structure.weeks.length > 0) {
    const fetchedGamesPerWeek = await Promise.all(
      structure.weeks.map((week) =>
        provider.fetchNflWeekGames(upcomingSeasonYear, week.weekType, week.weekNumber),
      ),
    );
    // Same last-wins dedupe rationale as the main sync (a rescheduled game
    // transiently double-listed would otherwise abort the multi-row upsert).
    const dedupedByProviderId = new Map<string, ProviderGame>();
    for (const game of fetchedGamesPerWeek.flat()) {
      dedupedByProviderId.set(game.providerGameId, game);
    }
    const providerGames = [...dedupedByProviderId.values()];

    await db.transaction((tx) =>
      ingestSeasonSnapshot(tx, now, upcomingSeasonYear, structure.weeks, providerGames, {
        provisional: false,
        providerTeams,
      }),
    );
    return { upcoming: UPCOMING_STATUS.REAL, upcomingSeasonYear };
  }

  // Not published yet — fabricate a plausible skeleton, never games
  // (`leagueStartAt` must keep returning null for a provisional season).
  await db.transaction((tx) =>
    ingestSeasonSnapshot(tx, now, upcomingSeasonYear, estimatedNflWeeks(upcomingSeasonYear), [], {
      provisional: true,
      providerTeams,
    }),
  );
  return { upcoming: UPCOMING_STATUS.PROVISIONAL, upcomingSeasonYear };
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
 *
 * A bare no-arg call (the daily cron shape) additionally ensures next year's
 * season exists once the default season concludes (ADR-0009) — explicit
 * `?season=`/`?week=` callers (manual/simulator) opt out of that step so they
 * stay surgical.
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
  const isBareTrigger = opts?.seasonYear === undefined && opts?.weekNumber === undefined;
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
  // Teams listing is season-independent — fetched once per run (alongside the
  // per-week game fetches) and forwarded to every `ingestSeasonSnapshot` call
  // this run makes, including the offseason "ensure next season" step below,
  // so a single job run never hits the endpoint more than once.
  const [fetchedGamesPerWeek, providerTeams] = await Promise.all([
    Promise.all(
      weeksToFetch.map((week) =>
        provider.fetchNflWeekGames(seasonYear, week.weekType, week.weekNumber),
      ),
    ),
    provider.fetchNflTeams(),
  ]);

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

  const result = await db.transaction((tx) =>
    // A normal sync always represents real data — `provisional: false`
    // clears an existing provisional flag in place if this season had one
    // (ADR-0009), e.g. an explicit `?season=` trigger fired the day ESPN
    // publishes.
    ingestSeasonSnapshot(tx, now, seasonYear, structure.weeks, providerGames, {
      provisional: false,
      providerTeams,
    }),
  );

  const details: Record<string, string | number | boolean> = {
    seasonYear,
    weeksSynced: result.weeksSynced,
    weeksDeleted: result.weeksDeleted,
    teamsCreated: result.teamsCreated,
    teamsEnriched: result.teamsEnriched,
    gamesCreated: result.gamesCreated,
    gamesUpdated: result.gamesUpdated,
    duplicateProviderGames,
    postponements: result.postponements,
    cancellations: result.cancellations,
    weekMoves: result.weekMoves,
    kickoffChanges: result.kickoffChanges,
  };

  if (!isBareTrigger) {
    return details;
  }

  const upcoming = await ensureUpcomingNflSeason(db, clock, provider, seasonYear, providerTeams);
  return { ...details, ...upcoming };
}
