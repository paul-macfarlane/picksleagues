import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueSeasons, leagues, sportSeasons } from "@picksleagues/db";
import type { LeagueSettings, LeagueStatus } from "@picksleagues/schemas";
import type { LeagueRow } from "./serialize";

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
