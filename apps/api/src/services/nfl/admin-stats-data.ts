import { asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@picksleagues/db";
import { games, nflGameStatContext, nflTeamSeasonStats, teams } from "@picksleagues/db";
import {
  NflGameStatContextOverridePayloadSchema,
  NflGameStatContextPayloadSchema,
  type AdminNflGameStatContext,
  type AdminNflTeamSeasonStats,
  type AdminNflTeamSeasonStatsResponse,
} from "@picksleagues/schemas";
import { effectiveKickoffAtSql } from "../games";
import { resolveNflGameStatContext, resolveNflTeamSeasonStatsOverrides } from "./game-stats";

/**
 * Queries behind the admin Stats browsers (STAT-7, ADR-0041) — read-only by
 * construction, like `services/admin-data.ts`: the browsers double as the
 * verification surface for the stats sync (a season with missing teams, a
 * synced week whose games have no context yet, an override that survived a
 * re-sync are all visible here). Writes live in `admin-stats-overrides.ts`.
 */

type DbStatsRow = typeof nflTeamSeasonStats.$inferSelect;

function serializeAdminStats(
  row: DbStatsRow,
  team: { id: string; abbreviation: string; name: string },
): AdminNflTeamSeasonStats {
  const effective = resolveNflTeamSeasonStatsOverrides(row);
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
    overrideWins: row.overrideWins,
    overrideLosses: row.overrideLosses,
    overrideTies: row.overrideTies,
    overrideHomeWins: row.overrideHomeWins,
    overrideHomeLosses: row.overrideHomeLosses,
    overrideHomeTies: row.overrideHomeTies,
    overrideRoadWins: row.overrideRoadWins,
    overrideRoadLosses: row.overrideRoadLosses,
    overrideRoadTies: row.overrideRoadTies,
    overrideStreak: row.overrideStreak,
    overridePointsFor: row.overridePointsFor,
    overridePointsAgainst: row.overridePointsAgainst,
    overriddenBy: row.overriddenBy,
    overriddenAt: row.overriddenAt?.toISOString() ?? null,
    effectiveWins: effective.wins,
    effectiveLosses: effective.losses,
    effectiveTies: effective.ties,
    effectiveHomeWins: effective.homeWins,
    effectiveHomeLosses: effective.homeLosses,
    effectiveHomeTies: effective.homeTies,
    effectiveRoadWins: effective.roadWins,
    effectiveRoadLosses: effective.roadLosses,
    effectiveRoadTies: effective.roadTies,
    effectiveStreak: effective.streak,
    effectivePointsFor: effective.pointsFor,
    effectivePointsAgainst: effective.pointsAgainst,
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
      team: { id: teams.id, abbreviation: teams.abbreviation, name: teams.name },
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
 * One stats row in the browser's shape, so the override write can answer with
 * the row the operator was just editing. Null when the row doesn't exist.
 */
export async function loadAdminNflTeamSeasonStats(
  db: Db,
  statsId: string,
): Promise<AdminNflTeamSeasonStats | null> {
  const [row] = await db
    .select({
      stats: nflTeamSeasonStats,
      team: { id: teams.id, abbreviation: teams.abbreviation, name: teams.name },
    })
    .from(nflTeamSeasonStats)
    .innerJoin(teams, eq(teams.id, nflTeamSeasonStats.teamId))
    .where(eq(nflTeamSeasonStats.id, statsId));
  if (!row) return null;
  return serializeAdminStats(row.stats, row.team);
}

/**
 * The joined shape both context reads project from — extracted so the week
 * list and the one-game read (the override write's response) can't drift.
 */
function selectContextRows(db: Db, where: SQL | undefined) {
  const homeTeams = alias(teams, "home_teams");
  const awayTeams = alias(teams, "away_teams");
  return (
    db
      .select({
        // The *resolved* kickoff (override ?? provider, arch D15): kickoff is
        // orientation here, not an editable layer of this surface, and a bare
        // provider instant would contradict the games browser after a kickoff
        // correction. `mapWith` borrows the column's decoder — a bare SQL
        // expression comes back as pg's raw string, not a Date. Wrapped in a
        // fresh template first because `mapWith` mutates its receiver, and the
        // shared constant must stay decoder-free for its ORDER BY/WHERE
        // callers (the season-range idiom).
        game: {
          id: games.id,
          kickoffAt: sql`${effectiveKickoffAtSql}`.mapWith(games.kickoffAt),
          providerGameId: games.providerGameId,
        },
        homeTeam: { id: homeTeams.id, abbreviation: homeTeams.abbreviation, name: homeTeams.name },
        awayTeam: { id: awayTeams.id, abbreviation: awayTeams.abbreviation, name: awayTeams.name },
        context: nflGameStatContext,
      })
      .from(games)
      .innerJoin(homeTeams, eq(homeTeams.id, games.homeTeamId))
      .innerJoin(awayTeams, eq(awayTeams.id, games.awayTeamId))
      .leftJoin(nflGameStatContext, eq(nflGameStatContext.gameId, games.id))
      .where(where)
      // Effective kickoff, like the games browser: a corrected game sorts where
      // an operator expects to find it.
      .orderBy(asc(effectiveKickoffAtSql), asc(games.providerGameId))
  );
}

type ContextRow = Awaited<ReturnType<typeof selectContextRows>>[number];

function serializeContextRow(row: ContextRow): AdminNflGameStatContext {
  let block: AdminNflGameStatContext["context"] = null;
  if (row.context) {
    // Parsed like the member read (defaults materialize — the league-settings
    // pattern), and resolved through the same field-level precedence helper,
    // so the "effective" block here is exactly what the matchup sheet serves.
    const payload = NflGameStatContextPayloadSchema.parse(row.context.payload);
    const override = row.context.overridePayload
      ? NflGameStatContextOverridePayloadSchema.parse(row.context.overridePayload)
      : null;
    block = {
      payload,
      overridePayload: override,
      effective: resolveNflGameStatContext(payload, override),
      overriddenBy: row.context.overriddenBy,
      overriddenAt: row.context.overriddenAt?.toISOString() ?? null,
      updatedAt: row.context.updatedAt.toISOString(),
    };
  }
  return {
    gameId: row.game.id,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    kickoffAt: row.game.kickoffAt.toISOString(),
    context: block,
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
  const rows = await selectContextRows(db, eq(games.weekId, weekId));
  return rows.map(serializeContextRow);
}

/** One game's context row in the browser's shape. Null when the game doesn't exist. */
export async function loadAdminNflGameStatContext(
  db: Db,
  gameId: string,
): Promise<AdminNflGameStatContext | null> {
  const [row] = await selectContextRows(db, eq(games.id, gameId));
  if (!row) return null;
  return serializeContextRow(row);
}
