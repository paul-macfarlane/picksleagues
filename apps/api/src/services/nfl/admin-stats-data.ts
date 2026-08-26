import { asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@picksleagues/db";
import { games, nflGameStatContext, nflTeamSeasonStats, teams } from "@picksleagues/db";
import {
  NflGameStatContextPayloadSchema,
  type AdminNflGameStatContext,
  type AdminNflTeamSeasonStats,
  type AdminNflTeamSeasonStatsResponse,
} from "@picksleagues/schemas";
import { teamLabelColumns } from "../teams";

/**
 * Queries behind the admin Stats browsers (STAT-7) — read-only by
 * construction, like `services/admin-data.ts`: the browsers are the
 * verification surface for the stats sync (a season with missing teams, a
 * synced week whose games have no context yet are both visible here).
 */

type DbStatsRow = typeof nflTeamSeasonStats.$inferSelect;

function serializeAdminStats(
  row: DbStatsRow,
  team: { id: string; abbreviation: string; name: string },
): AdminNflTeamSeasonStats {
  return {
    id: row.id,
    team,
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
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The season-stats browser's page. `requestedYear` absent defaults to the
 * newest stored season — the browser opens on something useful with no
 * client-side guessing; a requested year with no rows serves an empty list
 * under that year (the honest answer, not a silent fallback to a different
 * season).
 */
export async function listNflTeamSeasonStats(
  db: Db,
  requestedYear?: number,
): Promise<AdminNflTeamSeasonStatsResponse> {
  const yearRows = await db
    .selectDistinct({ seasonYear: nflTeamSeasonStats.seasonYear })
    .from(nflTeamSeasonStats)
    .orderBy(desc(nflTeamSeasonStats.seasonYear));
  const seasonYears = yearRows.map((row) => row.seasonYear);

  const seasonYear = requestedYear ?? seasonYears[0] ?? null;
  if (seasonYear === null) return { seasonYears, seasonYear, stats: [] };

  const rows = await db
    .select({
      stats: nflTeamSeasonStats,
      team: teamLabelColumns(teams),
    })
    .from(nflTeamSeasonStats)
    .innerJoin(teams, eq(teams.id, nflTeamSeasonStats.teamId))
    .where(eq(nflTeamSeasonStats.seasonYear, seasonYear))
    .orderBy(asc(teams.abbreviation));

  return {
    seasonYears,
    seasonYear,
    stats: rows.map(({ stats, team }) => serializeAdminStats(stats, team)),
  };
}

/**
 * A week's games with their stored context, context-less games included — a
 * synced week with a context gap is a verification signal, never a hidden row.
 */
export async function listNflGameStatContexts(
  db: Db,
  weekId: string,
): Promise<AdminNflGameStatContext[]> {
  const homeTeams = alias(teams, "home_teams");
  const awayTeams = alias(teams, "away_teams");
  const rows = await db
    .select({
      // Kickoff is orientation here, not an editable layer of this surface.
      game: {
        id: games.id,
        kickoffAt: games.kickoffAt,
        providerGameId: games.providerGameId,
      },
      homeTeam: teamLabelColumns(homeTeams),
      awayTeam: teamLabelColumns(awayTeams),
      context: nflGameStatContext,
    })
    .from(games)
    .innerJoin(homeTeams, eq(homeTeams.id, games.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, games.awayTeamId))
    .leftJoin(nflGameStatContext, eq(nflGameStatContext.gameId, games.id))
    .where(eq(games.weekId, weekId))
    .orderBy(asc(games.kickoffAt), asc(games.providerGameId));

  return rows.map((row) => ({
    gameId: row.game.id,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    kickoffAt: row.game.kickoffAt.toISOString(),
    context: row.context
      ? {
          // Parsed like the member read (defaults materialize — the
          // league-settings pattern), so the block here is exactly what the
          // matchup sheet serves.
          payload: NflGameStatContextPayloadSchema.parse(row.context.payload),
          updatedAt: row.context.updatedAt.toISOString(),
        }
      : null,
  }));
}
