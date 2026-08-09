import { desc, eq, max, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueSeasons, leagues, sportSeasons } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_MODE,
  SPORT,
  type LeagueMode,
  type LeagueResponse,
  type LeagueSettings,
  type LeagueStatus,
  type Sport,
} from "@picksleagues/schemas";
import { isPreStart, leagueStartAt } from "./start";
import { loadMembers, serializeLeague, type LeagueRow } from "./serialize";

/** The sport whose seasons a mode's leagues bind to (create + renewal). */
export function sportForMode(mode: LeagueMode): Sport {
  return mode === LEAGUE_MODE.MARCH_MADNESS ? SPORT.NCAAMB : SPORT.NFL;
}

export type SportSeasonRow = typeof sportSeasons.$inferSelect;

/**
 * The latest ingested `sport_seasons` row for one sport, or null when the
 * sport has no seasons yet. `createLeague` and `renewLeagueSeason` both need
 * the full row (id + year); this is the one query definition for it.
 */
export async function latestSeasonForSport(db: Db, sport: Sport): Promise<SportSeasonRow | null> {
  const [row] = await db
    .select()
    .from(sportSeasons)
    .where(eq(sportSeasons.sport, sport))
    .orderBy(desc(sportSeasons.year))
    .limit(1);
  return row ?? null;
}

/**
 * The greatest ingested `sport_seasons.year` for one sport, or null when the
 * sport has no seasons yet. Single-league serializers use this to derive
 * `renewable`.
 */
export async function latestSeasonYearForSport(db: Db, sport: Sport): Promise<number | null> {
  const season = await latestSeasonForSport(db, sport);
  return season?.year ?? null;
}

/**
 * The greatest ingested year per sport in one query — the multi-league list
 * (`listMyLeagues`) resolves every league's `renewable` from this map instead
 * of a per-league lookup (no N+1).
 */
export async function latestSeasonYearBySport(db: Db): Promise<Map<Sport, number>> {
  const rows = await db
    .select({ sport: sportSeasons.sport, latest: max(sportSeasons.year) })
    .from(sportSeasons)
    .groupBy(sportSeasons.sport);
  return new Map(rows.filter((r) => r.latest !== null).map((r) => [r.sport, r.latest as number]));
}

/** A newer season exists for the sport than the instance's bound year. */
export function isRenewable(latestYear: number | null, currentYear: number): boolean {
  return latestYear !== null && latestYear > currentYear;
}

/**
 * A league's per-season instance as every read/mutation needs it (ADR-0009):
 * the instance id, its season anchor + display year, the parsed settings, and
 * the status. `id` is the `league_seasons` row (settings writes target it);
 * `seasonId` is the `sport_seasons` anchor `leagueStartAt` derives locks from.
 */
export interface CurrentLeagueSeason {
  id: string;
  seasonId: string;
  seasonYear: number;
  settings: LeagueSettings;
  status: LeagueStatus;
}

export interface LeagueWithCurrentSeason {
  league: LeagueRow;
  season: CurrentLeagueSeason;
}

/**
 * The single home for "join a league to its current instance" (ADR-0009): a
 * league's current season is its instance with the greatest `sport_seasons.year`
 * — derived, no pointer column. Returns null when the league is absent (or, in
 * a transient state that shouldn't occur, has no instance). Callers holding a
 * lock must pass their `tx` so the read stays inside the same transaction.
 */
export async function getLeagueWithCurrentSeason(
  db: Db,
  leagueId: string,
): Promise<LeagueWithCurrentSeason | null> {
  const [row] = await db
    .select({
      league: leagues,
      instanceId: leagueSeasons.id,
      seasonId: leagueSeasons.seasonId,
      settings: leagueSeasons.settings,
      status: leagueSeasons.status,
      seasonYear: sportSeasons.year,
    })
    .from(leagues)
    .innerJoin(leagueSeasons, eq(leagueSeasons.leagueId, leagues.id))
    .innerJoin(sportSeasons, eq(sportSeasons.id, leagueSeasons.seasonId))
    .where(eq(leagues.id, leagueId))
    .orderBy(desc(sportSeasons.year))
    .limit(1);
  if (!row) return null;
  return {
    league: row.league,
    season: {
      id: row.instanceId,
      seasonId: row.seasonId,
      seasonYear: row.seasonYear,
      settings: row.settings,
      status: row.status,
    },
  };
}

/**
 * The window axis of the LEAGUE_ACTION matrix, resolved for one league: its
 * current instance's start (arch §Locking Model) against the injected Clock.
 * A caller inside a transaction passes its `tx` so the read shares the
 * snapshot its lock established. An absent league reads as started — the
 * caller's role gate has already refused a non-member by then, so the only
 * way here is a league that vanished mid-request, and refusing is the safe
 * side of that race.
 */
export async function leagueIsPreStart(db: Db, clock: Clock, leagueId: string): Promise<boolean> {
  const current = await getLeagueWithCurrentSeason(db, leagueId);
  if (!current) return false;
  const startsAt = await leagueStartAt(
    db,
    { mode: current.league.mode, seasonId: current.season.seasonId },
    current.season.settings,
  );
  return isPreStart(startsAt, clock);
}

/**
 * The shared assembly behind every "read one league" response: current
 * instance → start → members → renewable → the wire shape. `getLeague`,
 * `createLeague`, and `renewLeagueSeason` all serialize the league they just
 * touched through this one path rather than repeating the five steps.
 * Callers gate visibility (membership, post-commit freshness) before calling.
 */
export async function readAndSerializeLeague(
  db: Db,
  leagueId: string,
  viewerId: string,
): Promise<LeagueResponse | null> {
  const current = await getLeagueWithCurrentSeason(db, leagueId);
  if (!current) return null;
  const { league, season } = current;

  const startsAt = await leagueStartAt(
    db,
    { mode: league.mode, seasonId: season.seasonId },
    season.settings,
  );
  const members = await loadMembers(db, leagueId);
  const latestYear = await latestSeasonYearForSport(db, sportForMode(league.mode));
  return serializeLeague(
    league,
    season.status,
    season.seasonYear,
    season.settings,
    startsAt,
    members,
    viewerId,
    isRenewable(latestYear, season.seasonYear),
  );
}

/**
 * The query-fragment form of the same rule for multi-league joins (list,
 * discovery, cap counts): a subquery yielding one candidate row per instance
 * ranked within its league by season year descending. Consumers innerJoin it on
 * `leagueId` and filter `rank = 1` to land on each league's current instance
 * (window functions can't be filtered in their own WHERE, hence the subquery).
 */
export function currentLeagueSeason(db: Db) {
  return db
    .select({
      leagueId: leagueSeasons.leagueId,
      instanceId: leagueSeasons.id,
      seasonId: leagueSeasons.seasonId,
      settings: leagueSeasons.settings,
      status: leagueSeasons.status,
      seasonYear: sportSeasons.year,
      rank: sql<number>`row_number() over (partition by ${leagueSeasons.leagueId} order by ${sportSeasons.year} desc)`.as(
        "rank",
      ),
    })
    .from(leagueSeasons)
    .innerJoin(sportSeasons, eq(sportSeasons.id, leagueSeasons.seasonId))
    .as("current_season");
}
