import { asc, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@picksleagues/db";
import {
  adminAudit,
  games,
  leagueSeasons,
  leagues,
  sportSeasons,
  teams,
  users,
  weeks,
} from "@picksleagues/db";
import {
  ADMIN_AUDIT_TARGET_TABLE,
  type AdminAuditEntry,
  type AdminAuditTargetTable,
  type AdminGame,
  type AdminSeason,
  type AdminTeam,
  type Sport,
} from "@picksleagues/schemas";
import { effectiveKickoffAtSql, resolveGameOverrides } from "./games";

/**
 * Queries behind the admin page's read-only reference-data browsers and the
 * audit view (arch §Manual Sports Data Overrides). Read-only by construction:
 * nothing here writes, and the browsers double as the verification surface for
 * the sync jobs (a week with zero games, a game with no spread, an override
 * that survived a re-sync are all visible here).
 *
 * Each reference-data list is bounded by its own domain (one sport's teams, one
 * sport's seasons, one week's games), so those don't paginate. `admin_audit`
 * has no such bound — it only grows — which is why the audit read is the one
 * paginated query here.
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

/**
 * The joined shape both game reads below project from. Extracted so the
 * one-game read (the override write's response) and the week list can't drift
 * on which columns the `AdminGame` block is built from.
 */
function selectAdminGameRows(db: Db, where: SQL | undefined) {
  const homeTeams = alias(teams, "home_teams");
  const awayTeams = alias(teams, "away_teams");

  return (
    db
      .select({
        game: games,
        homeTeam: { id: homeTeams.id, abbreviation: homeTeams.abbreviation, name: homeTeams.name },
        awayTeam: { id: awayTeams.id, abbreviation: awayTeams.abbreviation, name: awayTeams.name },
      })
      .from(games)
      .innerJoin(homeTeams, eq(homeTeams.id, games.homeTeamId))
      .innerJoin(awayTeams, eq(awayTeams.id, games.awayTeamId))
      .where(where)
      // Ordered by the kickoff the app actually uses, so a corrected game sorts
      // where an operator expects to find it.
      .orderBy(asc(effectiveKickoffAtSql), asc(games.providerGameId))
  );
}

type AdminGameRow = Awaited<ReturnType<typeof selectAdminGameRows>>[number];

function serializeAdminGame({ game, homeTeam, awayTeam }: AdminGameRow): AdminGame {
  const effective = resolveGameOverrides(game);
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
    period: game.period,
    clockSeconds: game.clockSeconds,
    spread: game.spread,
    overrideKickoffAt: game.overrideKickoffAt?.toISOString() ?? null,
    overrideStatus: game.overrideStatus,
    overrideHomeScore: game.overrideHomeScore,
    overrideAwayScore: game.overrideAwayScore,
    overrideSpread: game.overrideSpread,
    overridePeriod: game.overridePeriod,
    overrideClockSeconds: game.overrideClockSeconds,
    overriddenBy: game.overriddenBy,
    overriddenAt: game.overriddenAt?.toISOString() ?? null,
    effectiveKickoffAt: effective.kickoffAt.toISOString(),
    effectiveStatus: effective.status,
    effectiveHomeScore: effective.homeScore,
    effectiveAwayScore: effective.awayScore,
    effectiveSpread: effective.spread,
    effectivePeriod: effective.period,
    effectiveClockSeconds: effective.clockSeconds,
  };
}

export async function listWeekGames(db: Db, weekId: string): Promise<AdminGame[]> {
  const rows = await selectAdminGameRows(db, eq(games.weekId, weekId));
  return rows.map(serializeAdminGame);
}

/**
 * One game in the same shape the browser lists, so the override write can
 * answer with the row an operator was just editing — provider, override, and
 * resolved values side by side. Null when the game doesn't exist.
 */
export async function loadAdminGame(db: Db, gameId: string): Promise<AdminGame | null> {
  const [row] = await selectAdminGameRows(db, eq(games.id, gameId));
  if (!row) return null;

  return serializeAdminGame(row);
}

function targetKey(targetTable: AdminAuditTargetTable, targetId: string) {
  return `${targetTable}:${targetId}`;
}

/**
 * Human labels for a page of audit rows, resolved as a lookup *applied to* rows
 * already fetched rather than as a join in the list query. An audit row outlives
 * its target — a deleted league keeps every rebuild recorded against it — so a
 * join would silently drop exactly the rows that record what happened to
 * something now gone. A target with no row left simply gets no entry here, and
 * the caller serializes `targetLabel: null`.
 *
 * One query per target table, both keyed by an `inArray` over the page's ids, so
 * the cost is fixed regardless of page size.
 */
async function resolveTargetLabels(
  db: Db,
  rows: ReadonlyArray<{ targetTable: AdminAuditTargetTable; targetId: string }>,
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const idsFor = (targetTable: AdminAuditTargetTable) => [
    ...new Set(rows.filter((row) => row.targetTable === targetTable).map((row) => row.targetId)),
  ];

  const gameIds = idsFor(ADMIN_AUDIT_TARGET_TABLE.GAMES);
  if (gameIds.length > 0) {
    const homeTeams = alias(teams, "label_home_teams");
    const awayTeams = alias(teams, "label_away_teams");
    const gameRows = await db
      .select({
        id: games.id,
        homeAbbreviation: homeTeams.abbreviation,
        awayAbbreviation: awayTeams.abbreviation,
      })
      .from(games)
      .innerJoin(homeTeams, eq(homeTeams.id, games.homeTeamId))
      .innerJoin(awayTeams, eq(awayTeams.id, games.awayTeamId))
      .where(inArray(games.id, gameIds));
    for (const game of gameRows) {
      labels.set(
        targetKey(ADMIN_AUDIT_TARGET_TABLE.GAMES, game.id),
        // Away-first, matching how a matchup is named everywhere else in the
        // product, so the trail reads like the slate it corrected.
        `${game.awayAbbreviation} @ ${game.homeAbbreviation}`,
      );
    }
  }

  const leagueSeasonIds = idsFor(ADMIN_AUDIT_TARGET_TABLE.LEAGUE_SEASONS);
  if (leagueSeasonIds.length > 0) {
    const seasonRows = await db
      .select({ id: leagueSeasons.id, name: leagues.name, year: sportSeasons.year })
      .from(leagueSeasons)
      .innerJoin(leagues, eq(leagues.id, leagueSeasons.leagueId))
      .innerJoin(sportSeasons, eq(sportSeasons.id, leagueSeasons.seasonId))
      .where(inArray(leagueSeasons.id, leagueSeasonIds));
    for (const season of seasonRows) {
      // The year disambiguates a league that has renewed (ADR-0009): two
      // instances of one league otherwise label identically.
      labels.set(
        targetKey(ADMIN_AUDIT_TARGET_TABLE.LEAGUE_SEASONS, season.id),
        `${season.name} ${season.year}`,
      );
    }
  }

  return labels;
}

/**
 * One page of the admin action log, newest first. `id` desc breaks ties on
 * `createdAt` so a page boundary can't drop or repeat a row when several
 * actions share an instant — which they do routinely, since `createdAt` comes
 * from the injected Clock and the simulator's is fixed for a whole request.
 *
 * `total` is its own `count(*)` over the whole table rather than a
 * `count(*) OVER ()` on the page: the window form ties the total's correctness
 * to the page's `where`, and the two questions ("how much is there" and "which
 * slice am I looking at") are deliberately independent here.
 */
export async function listAuditEntries(
  db: Db,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ entries: AdminAuditEntry[]; total: number }> {
  const [totalRow] = await db.select({ value: count() }).from(adminAudit);

  const rows = await db
    .select({
      id: adminAudit.id,
      action: adminAudit.action,
      targetTable: adminAudit.targetTable,
      targetId: adminAudit.targetId,
      priorValue: adminAudit.priorValue,
      createdAt: adminAudit.createdAt,
      displayName: users.display_name,
      username: users.username,
    })
    .from(adminAudit)
    // Safe as a join, unlike the target labels: the actor FK is restrict and
    // accounts are anonymized in place rather than deleted, so this can never
    // drop a row.
    .innerJoin(users, eq(users.id, adminAudit.adminUserId))
    .orderBy(desc(adminAudit.createdAt), desc(adminAudit.id))
    .limit(limit)
    .offset(offset);

  const labels = await resolveTargetLabels(db, rows);

  return {
    total: totalRow?.value ?? 0,
    entries: rows.map((row) => ({
      id: row.id,
      admin: { displayName: row.displayName, username: row.username },
      action: row.action,
      targetTable: row.targetTable,
      targetId: row.targetId,
      targetLabel: labels.get(targetKey(row.targetTable, row.targetId)) ?? null,
      priorValue: row.priorValue,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
