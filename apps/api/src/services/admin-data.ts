import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@picksleagues/db";
import { games, oddsSnapshots, sportSeasons, teams, weeks } from "@picksleagues/db";
import {
  ADMIN_ODDS_SNAPSHOT_LIMIT,
  type AdminGame,
  type AdminOddsSnapshot,
  type AdminSeason,
  type AdminTeam,
  type Sport,
} from "@picksleagues/schemas";
import { effectiveKickoffAtSql, resolveGameOverrides } from "./games";
import { latestSpreadsForGames } from "./odds";

/**
 * Queries behind the admin page's read-only reference-data browsers (arch
 * §Manual Sports Data Overrides). Read-only by construction: nothing here
 * writes, and the browsers double as the verification surface for the sync jobs
 * (a week with zero games, a game with no odds snapshot, an override that
 * survived a re-sync are all visible here).
 *
 * Every list is bounded by its own domain (one sport's teams, one sport's
 * seasons, one week's games, one game's latest snapshots), so none of these
 * paginate.
 */

export async function listTeams(db: Db, sport: Sport): Promise<AdminTeam[]> {
  const rows = await db
    .select()
    .from(teams)
    .where(eq(teams.sport, sport))
    .orderBy(asc(teams.abbreviation));

  return rows.map((team) => ({
    id: team.id,
    sport: team.sport,
    providerTeamId: team.providerTeamId,
    abbreviation: team.abbreviation,
    name: team.name,
    location: team.location,
    logoLightUrl: team.logoLightUrl,
    logoDarkUrl: team.logoDarkUrl,
    updatedAt: team.updatedAt.toISOString(),
  }));
}

export async function listSeasons(db: Db, sport: Sport): Promise<AdminSeason[]> {
  const seasonRows = await db
    .select()
    .from(sportSeasons)
    .where(eq(sportSeasons.sport, sport))
    .orderBy(desc(sportSeasons.year));
  if (seasonRows.length === 0) return [];

  const seasonIds = seasonRows.map((season) => season.id);
  const weekRows = await db
    .select()
    .from(weeks)
    .where(inArray(weeks.seasonId, seasonIds))
    // Chronological rather than by (type, number): that is the order an
    // operator scans for a gap, and it puts postseason after regular without
    // depending on the enum's declaration order.
    .orderBy(asc(weeks.startsAt), asc(weeks.weekNumber));

  const gameCounts =
    weekRows.length === 0
      ? []
      : await db
          .select({ weekId: games.weekId, value: count() })
          .from(games)
          .where(
            inArray(
              games.weekId,
              weekRows.map((week) => week.id),
            ),
          )
          .groupBy(games.weekId);
  const gameCountByWeek = new Map(gameCounts.map((row) => [row.weekId, row.value]));

  return seasonRows.map((season) => ({
    id: season.id,
    sport: season.sport,
    year: season.year,
    provisional: season.provisional,
    weeks: weekRows
      .filter((week) => week.seasonId === season.id)
      .map((week) => ({
        id: week.id,
        weekType: week.weekType,
        weekNumber: week.weekNumber,
        label: week.label,
        startsAt: week.startsAt.toISOString(),
        endsAt: week.endsAt.toISOString(),
        gameCount: gameCountByWeek.get(week.id) ?? 0,
      })),
  }));
}

export async function listWeekGames(db: Db, weekId: string): Promise<AdminGame[]> {
  const homeTeams = alias(teams, "home_teams");
  const awayTeams = alias(teams, "away_teams");

  const rows = await db
    .select({
      game: games,
      homeTeam: { id: homeTeams.id, abbreviation: homeTeams.abbreviation, name: homeTeams.name },
      awayTeam: { id: awayTeams.id, abbreviation: awayTeams.abbreviation, name: awayTeams.name },
    })
    .from(games)
    .innerJoin(homeTeams, eq(homeTeams.id, games.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, games.awayTeamId))
    .where(eq(games.weekId, weekId))
    // Ordered by the kickoff the app actually uses, so a corrected game sorts
    // where an operator expects to find it.
    .orderBy(asc(effectiveKickoffAtSql), asc(games.providerGameId));
  if (rows.length === 0) return [];

  // The latest snapshot is what a browser means by "current spread" —
  // the same resolution the pick slate and pick-time validation use.
  const latestByGame = await latestSpreadsForGames(
    db,
    rows.map((row) => row.game.id),
  );

  return rows.map(({ game, homeTeam, awayTeam }) => {
    const latest = latestByGame.get(game.id) ?? null;
    const effective = resolveGameOverrides(game, latest?.spread ?? null);
    return {
      id: game.id,
      weekId: game.weekId,
      providerGameId: game.providerGameId,
      homeTeam,
      awayTeam,
      kickoffAt: game.kickoffAt.toISOString(),
      status: game.status,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      latestSpread: latest?.spread ?? null,
      latestSpreadCapturedAt: latest?.capturedAt.toISOString() ?? null,
      overrideKickoffAt: game.overrideKickoffAt?.toISOString() ?? null,
      overrideStatus: game.overrideStatus,
      overrideHomeScore: game.overrideHomeScore,
      overrideAwayScore: game.overrideAwayScore,
      overrideSpread: game.overrideSpread,
      overriddenBy: game.overriddenBy,
      overriddenAt: game.overriddenAt?.toISOString() ?? null,
      effectiveKickoffAt: effective.kickoffAt.toISOString(),
      effectiveStatus: effective.status,
      effectiveHomeScore: effective.homeScore,
      effectiveAwayScore: effective.awayScore,
      effectiveSpread: effective.spread,
    };
  });
}

/** Null when the game doesn't exist — distinct from a game with no snapshots yet. */
export async function listGameOdds(db: Db, gameId: string): Promise<AdminOddsSnapshot[] | null> {
  const [game] = await db.select({ id: games.id }).from(games).where(eq(games.id, gameId));
  if (!game) return null;

  const rows = await db
    .select()
    .from(oddsSnapshots)
    .where(eq(oddsSnapshots.gameId, gameId))
    // Same tiebreak as the latest-snapshot query above — without it, which rows
    // survive the LIMIT boundary is arbitrary among equal `captured_at`.
    .orderBy(desc(oddsSnapshots.capturedAt), desc(oddsSnapshots.id))
    .limit(ADMIN_ODDS_SNAPSHOT_LIMIT);

  return rows.map((snapshot) => ({
    id: snapshot.id,
    spread: snapshot.spread,
    capturedAt: snapshot.capturedAt.toISOString(),
  }));
}
