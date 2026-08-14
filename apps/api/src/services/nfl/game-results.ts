import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons, teams, weeks } from "@picksleagues/db";
import {
  GAME_STATUS,
  isStartedStatus,
  NFL_LAST_GAME_RESULT,
  type GameStatus,
  type NflGameLogEntry,
  type NflGameResultsResponse,
  type NflTeamGameLog,
} from "@picksleagues/schemas";
import { resolveGameOverrides } from "../games";

/**
 * The Results segment read (STAT-9): both teams' season game logs, served
 * entirely from our `games` rows — zero new ingestion. Like the stats read it
 * is deliberately clockless (freshness is the stored `updated_at` the response
 * carries), and every fact comes through `resolveGameOverrides` so a corrected
 * score logs as corrected (arch D15).
 */

/** One candidate log game, already override-resolved. */
export type ResolvedLogGame = {
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

function toEntry(game: ResolvedLogGame, teamId: string): NflGameLogEntry {
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
    final,
    teamScore,
    opponentScore,
    result,
  };
}

/**
 * One team's log from the candidate-season rows. Exported for its unit tests;
 * pure. Started games only (in progress or final) — Results means what has
 * happened, and the upcoming schedule already lives on the slate. The season
 * choice mirrors the record block's per-team fallback (ADR-0040): the current
 * season once the team has a started game in it, else the prior season, else
 * null. Entries are newest first, matching the sheet's "Last 5" idiom — the
 * games that inform a pick are the recent ones, and the column says so.
 */
export function buildNflTeamGameLog(
  rows: ResolvedLogGame[],
  teamId: string,
  currentSeasonYear: number,
): NflTeamGameLog | null {
  const started = rows
    .filter(
      (row) =>
        (row.homeTeamId === teamId || row.awayTeamId === teamId) && isStartedStatus(row.status),
    )
    .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime());
  const current = started.filter((row) => row.seasonYear === currentSeasonYear);
  const chosen = current.length > 0 ? current : started;
  if (chosen.length === 0) return null;
  return {
    seasonYear: chosen === current ? currentSeasonYear : chosen[0]!.seasonYear,
    entries: chosen.map((row) => toEntry(row, teamId)),
  };
}

export async function getNflGameResults(
  db: Db,
  gameId: string,
): Promise<NflGameResultsResponse | null> {
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
  // and the prior one the fallback serves while a team has no started games
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

  const resolved: (ResolvedLogGame & { updatedAt: Date })[] = rows.map((row) => {
    const effective = resolveGameOverrides(row.game);
    return {
      seasonYear: row.seasonYear,
      weekLabel: row.weekLabel,
      kickoffAt: effective.kickoffAt,
      status: effective.status,
      homeTeamId: row.game.homeTeamId,
      awayTeamId: row.game.awayTeamId,
      homeAbbr: row.homeAbbr,
      awayAbbr: row.awayAbbr,
      homeScore: effective.homeScore,
      awayScore: effective.awayScore,
      updatedAt: row.game.updatedAt,
    };
  });

  const home = buildNflTeamGameLog(resolved, game.homeTeamId, game.seasonYear);
  const away = buildNflTeamGameLog(resolved, game.awayTeamId, game.seasonYear);
  // Newest write among the *started* rows — the pool the logs draw from, even
  // where a per-team season choice filtered a row out of the display. Wider
  // than strictly served, but the stamp's job is dating live scores, and a
  // started row's write instant is always a true "data as of" bound.
  const stamps = resolved
    .filter((row) => isStartedStatus(row.status))
    .map((row) => row.updatedAt.getTime());
  const updatedAt = stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : null;

  return { gameId: game.id, home, away, updatedAt };
}
