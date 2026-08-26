import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { resolveCurrentWeekId } from "./league-weeks";
import type { Db } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import { games, sportSeasons, teams, weeks } from "@picksleagues/db";
import type { AdminGame, AdminSeason, AdminTeam, Sport } from "@picksleagues/schemas";
import { teamLabelColumns } from "./teams";

/**
 * Queries behind the admin page's read-only reference-data browsers. Read-only
 * by construction: nothing here writes, and the browsers double as the
 * verification surface for the sync jobs (a week with zero games, a game with
 * no spread are both visible here).
 *
 * Each list is bounded by its own domain (one sport's teams, one sport's
 * seasons, one week's games), so none paginates.
 */

function serializeAdminTeam(team: typeof teams.$inferSelect): AdminTeam {
  return {
    id: team.id,
    sport: team.sport,
    providerTeamId: team.providerTeamId,
    abbreviation: team.abbreviation,
    name: team.name,
    location: team.location,
    logoLightUrl: team.logoLightUrl,
    logoDarkUrl: team.logoDarkUrl,
    updatedAt: team.updatedAt.toISOString(),
  };
}

export async function listTeams(db: Db, sport: Sport): Promise<AdminTeam[]> {
  const rows = await db
    .select()
    .from(teams)
    .where(eq(teams.sport, sport))
    .orderBy(asc(teams.abbreviation));

  return rows.map(serializeAdminTeam);
}

export async function listSeasons(db: Db, clock: Clock, sport: Sport): Promise<AdminSeason[]> {
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

  return seasonRows.map((season) => {
    const seasonWeeks = weekRows.filter((week) => week.seasonId === season.id);
    return {
      id: season.id,
      sport: season.sport,
      year: season.year,
      provisional: season.provisional,
      // The one current-week definition (league-weeks.ts), so the selectors
      // this feeds default to the same week every member surface calls current.
      currentWeekId: resolveCurrentWeekId(seasonWeeks, clock),
      weeks: seasonWeeks.map((week) => ({
        id: week.id,
        weekType: week.weekType,
        weekNumber: week.weekNumber,
        label: week.label,
        startsAt: week.startsAt.toISOString(),
        endsAt: week.endsAt.toISOString(),
        gameCount: gameCountByWeek.get(week.id) ?? 0,
      })),
    };
  });
}

export async function listWeekGames(db: Db, weekId: string): Promise<AdminGame[]> {
  const homeTeams = alias(teams, "home_teams");
  const awayTeams = alias(teams, "away_teams");

  const rows = await db
    .select({
      game: games,
      homeTeam: teamLabelColumns(homeTeams),
      awayTeam: teamLabelColumns(awayTeams),
    })
    .from(games)
    .innerJoin(homeTeams, eq(homeTeams.id, games.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, games.awayTeamId))
    .where(eq(games.weekId, weekId))
    .orderBy(asc(games.kickoffAt), asc(games.providerGameId));

  return rows.map(({ game, homeTeam, awayTeam }) => ({
    id: game.id,
    weekId: game.weekId,
    providerGameId: game.providerGameId,
    homeTeam,
    awayTeam,
    kickoffAt: game.kickoffAt.toISOString(),
    status: game.status,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    period: game.period,
    clockSeconds: game.clockSeconds,
    spread: game.spread,
  }));
}
