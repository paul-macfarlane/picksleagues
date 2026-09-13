import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons, teams, weeks } from "@picksleagues/db";
import {
  GAME_STATUS,
  NFL_LAST_GAME_RESULT,
  type GameStatus,
  type NflGameScheduleEntry,
  type NflGameScheduleResponse,
  type NflTeamSchedule,
} from "@picksleagues/schemas";

/**
 * The Schedule segment read: both teams' season schedules, served
 * entirely from our `games` rows — zero new ingestion. Like the stats read it
 * is deliberately clockless (freshness is the stored `updated_at` the response
 * carries).
 */

/** A stored fixture resolved with its season and team labels. */
export type ResolvedScheduleGame = {
  seasonYear: number;
  weekLabel: string;
  kickoffAt: Date;
  status: GameStatus;
  homeTeamId: string;
  awayTeamId: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number | null;
  awayScore: number | null;
};

function toEntry(game: ResolvedScheduleGame, teamId: string): NflGameScheduleEntry {
  const atHome = game.homeTeamId === teamId;
  const teamScore = atHome ? game.homeScore : game.awayScore;
  const opponentScore = atHome ? game.awayScore : game.homeScore;
  const final = game.status === GAME_STATUS.FINAL;
  // Result only when the outcome is knowable: a final with both scores. A
  // final missing a score (a sync anomaly) gets a null result and renders as
  // a dash rather than an invented outcome (ADR-0040: omit, never fabricate).
  const result =
    final && teamScore !== null && opponentScore !== null
      ? teamScore > opponentScore
        ? NFL_LAST_GAME_RESULT.WIN
        : teamScore < opponentScore
          ? NFL_LAST_GAME_RESULT.LOSS
          : NFL_LAST_GAME_RESULT.TIE
      : null;
  return {
    weekLabel: game.weekLabel,
    opponentAbbr: atHome ? game.awayAbbr : game.homeAbbr,
    atHome,
    kickoffAt: game.kickoffAt.toISOString(),
    status: game.status,
    teamScore,
    opponentScore,
    result,
  };
}

/**
 * One team's schedule from candidate-season rows. Exported for its unit tests;
 * pure. All ingested states remain visible, including disrupted fixtures.
 * The current season wins as soon as it has games: future opponents are
 * the reason this shared surface exists. Entries are kickoff-ordered, so a
 * member can scan the season chronologically.
 */
export function buildNflTeamSchedule(
  rows: ResolvedScheduleGame[],
  teamId: string,
  currentSeasonYear: number,
): NflTeamSchedule | null {
  const available = rows
    .filter((row) => row.homeTeamId === teamId || row.awayTeamId === teamId)
    .sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
  const current = available.filter((row) => row.seasonYear === currentSeasonYear);
  const chosen = current.length > 0 ? current : available;
  if (chosen.length === 0) return null;
  return {
    seasonYear: chosen === current ? currentSeasonYear : chosen[0]!.seasonYear,
    entries: chosen.map((row) => toEntry(row, teamId)),
  };
}

export async function getNflGameSchedule(
  db: Db,
  gameId: string,
): Promise<NflGameScheduleResponse | null> {
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

  const teamIds = [game.homeTeamId, game.awayTeamId];
  const homeTeams = alias(teams, "home_teams");
  const awayTeams = alias(teams, "away_teams");
  // Both candidate seasons in one read, like the stats read: the game's own,
  // and the prior one the fallback serves while a team has no ingested games
  // yet (ADR-0040).
  const candidateYears = [game.seasonYear, game.seasonYear - 1];
  const rows = await db
    .select({
      game: games,
      weekLabel: weeks.label,
      seasonYear: sportSeasons.year,
      homeAbbr: homeTeams.abbreviation,
      awayAbbr: awayTeams.abbreviation,
    })
    .from(games)
    .innerJoin(weeks, eq(games.weekId, weeks.id))
    .innerJoin(sportSeasons, eq(weeks.seasonId, sportSeasons.id))
    .innerJoin(homeTeams, eq(games.homeTeamId, homeTeams.id))
    .innerJoin(awayTeams, eq(games.awayTeamId, awayTeams.id))
    .where(
      and(
        eq(sportSeasons.sport, game.sport),
        inArray(sportSeasons.year, candidateYears),
        or(inArray(games.homeTeamId, teamIds), inArray(games.awayTeamId, teamIds)),
      ),
    );

  const resolved: (ResolvedScheduleGame & { updatedAt: Date })[] = rows.map((row) => ({
    seasonYear: row.seasonYear,
    weekLabel: row.weekLabel,
    kickoffAt: row.game.kickoffAt,
    status: row.game.status,
    homeTeamId: row.game.homeTeamId,
    awayTeamId: row.game.awayTeamId,
    homeAbbr: row.homeAbbr,
    awayAbbr: row.awayAbbr,
    homeScore: row.game.homeScore,
    awayScore: row.game.awayScore,
    updatedAt: row.game.updatedAt,
  }));

  const home = buildNflTeamSchedule(resolved, game.homeTeamId, game.seasonYear);
  const away = buildNflTeamSchedule(resolved, game.awayTeamId, game.seasonYear);
  // Both schedules are chosen from these rows, so the freshest served
  // fixture is the honest as-of bound for live scores and upcoming opponents.
  const stamps = resolved
    .filter(
      (row) =>
        ((row.homeTeamId === game.homeTeamId || row.awayTeamId === game.homeTeamId) &&
          row.seasonYear === home?.seasonYear) ||
        ((row.homeTeamId === game.awayTeamId || row.awayTeamId === game.awayTeamId) &&
          row.seasonYear === away?.seasonYear),
    )
    .map((row) => row.updatedAt.getTime());
  const updatedAt = stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : null;

  return { gameId: game.id, home, away, updatedAt };
}
