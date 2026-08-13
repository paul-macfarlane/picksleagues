import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  games,
  gameStatContext,
  sportSeasons,
  teams,
  teamSeasonStats,
  weeks,
} from "@picksleagues/db";
import {
  GameStatContextPayloadSchema,
  type GameStatsResponse,
  type GameStatsTeamRecord,
} from "@picksleagues/schemas";

/**
 * The matchup stats read (STAT-5, ADR-0040): serves `team_season_stats` +
 * `game_stat_context` for one game, entirely from our tables. Deliberately
 * clockless — nothing here derives from "now"; freshness is stated by the
 * stored `updated_at` stamps the response carries.
 */

type StatsRow = typeof teamSeasonStats.$inferSelect;

function gamesPlayed(row: StatsRow): number {
  return row.wins + row.losses + row.ties;
}

/**
 * Competition ranking ("1224": tied teams share a rank, the next rank skips)
 * over the teams that have played. Exported for its unit tests; pure.
 *
 * Null unless at least half the season's teams have played: the UI presents
 * the ordinal as a league rank, and on the Friday after week 1's Thursday
 * game the eligible pool is two teams — "1st" there states something far
 * stronger than the data holds (ADR-0040: omit, never fabricate). Half is a
 * legibility floor, not a statistics claim; by any ordinary week every team
 * has played and the guard is invisible.
 */
export function scoringRank(
  rows: StatsRow[],
  teamId: string,
  side: "offense" | "defense",
): number | null {
  const eligible = rows.filter((row) => gamesPlayed(row) > 0);
  if (eligible.length < Math.ceil(rows.length / 2)) return null;
  const mine = eligible.find((row) => row.teamId === teamId);
  if (!mine) return null;
  const value = (row: StatsRow) =>
    side === "offense"
      ? row.pointsFor / gamesPlayed(row)
      : // Defense ranks by fewest points allowed per game.
        -(row.pointsAgainst / gamesPlayed(row));
  const myValue = value(mine);
  return 1 + eligible.filter((row) => value(row) > myValue).length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function serializeRecord(row: StatsRow, seasonRows: StatsRow[]): GameStatsTeamRecord {
  const played = gamesPlayed(row);
  return {
    seasonYear: row.seasonYear,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    homeWins: row.homeWins,
    homeLosses: row.homeLosses,
    homeTies: row.homeTies,
    roadWins: row.roadWins,
    roadLosses: row.roadLosses,
    roadTies: row.roadTies,
    streak: row.streak,
    pointsFor: row.pointsFor,
    pointsAgainst: row.pointsAgainst,
    gamesPlayed: played,
    avgPointsFor: played > 0 ? round1(row.pointsFor / played) : null,
    avgPointsAgainst: played > 0 ? round1(row.pointsAgainst / played) : null,
    scoringOffenseRank: scoringRank(seasonRows, row.teamId, "offense"),
    scoringDefenseRank: scoringRank(seasonRows, row.teamId, "defense"),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getGameStats(db: Db, gameId: string): Promise<GameStatsResponse | null> {
  const [game] = await db
    .select({
      id: games.id,
      homeTeamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
      seasonYear: sportSeasons.year,
      sport: sportSeasons.sport,
    })
    .from(games)
    .innerJoin(weeks, eq(games.weekId, weeks.id))
    .innerJoin(sportSeasons, eq(weeks.seasonId, sportSeasons.id))
    .where(eq(games.id, gameId));
  if (!game) return null;

  // Both candidate seasons in one read: the game's own, and the prior one the
  // fallback serves while a team has no completed games yet (ADR-0040). The
  // whole league's rows come back (a few dozen), because ranks need the full
  // pool anyway. Sport-scoped so a future second sport can't pollute the pool.
  const candidateYears = [game.seasonYear, game.seasonYear - 1];
  const statRows = await db
    .select({ stats: teamSeasonStats })
    .from(teamSeasonStats)
    .innerJoin(teams, eq(teamSeasonStats.teamId, teams.id))
    .where(and(eq(teams.sport, game.sport), inArray(teamSeasonStats.seasonYear, candidateYears)));
  const rowsByYear = new Map<number, StatsRow[]>();
  for (const { stats } of statRows) {
    const bucket = rowsByYear.get(stats.seasonYear) ?? [];
    bucket.push(stats);
    rowsByYear.set(stats.seasonYear, bucket);
  }

  const teamBlock = (teamId: string): GameStatsTeamRecord | null => {
    const currentRows = rowsByYear.get(game.seasonYear) ?? [];
    const priorRows = rowsByYear.get(game.seasonYear - 1) ?? [];
    const current = currentRows.find((row) => row.teamId === teamId);
    const prior = priorRows.find((row) => row.teamId === teamId);
    // Per-team, not per-response: after a week-1 cancellation one side can
    // legitimately still be on last season while the other has real numbers —
    // each block names its own seasonYear, so mixed years stay legible.
    const useCurrent = current && (gamesPlayed(current) > 0 || !prior);
    const chosen = useCurrent ? current : (prior ?? current);
    if (!chosen) return null;
    return serializeRecord(chosen, chosen === current ? currentRows : priorRows);
  };

  const [contextRow] = await db
    .select()
    .from(gameStatContext)
    .where(eq(gameStatContext.gameId, gameId));
  // Parsed through the schema so additive payload evolution materializes its
  // defaults (engineering rules §Data — the league-settings pattern).
  const payload = contextRow ? GameStatContextPayloadSchema.parse(contextRow.payload) : null;

  return {
    gameId: game.id,
    home: teamBlock(game.homeTeamId),
    away: teamBlock(game.awayTeamId),
    context:
      payload && contextRow
        ? { home: payload.home, away: payload.away, updatedAt: contextRow.updatedAt.toISOString() }
        : null,
  };
}
