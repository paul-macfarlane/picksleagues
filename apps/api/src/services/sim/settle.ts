import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  leagueMembers,
  leagues,
  leagueSeasons,
  pickResults,
  sportSeasons,
  standings,
  users,
  weeks,
} from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ERROR_CODE,
  LEAGUE_MODE,
  LEAGUE_STATUS,
  type SimSettleLeagueResult,
  type SimSettleRequest,
  type SimSettleResponse,
  type SimSettleStandingsRow,
  type WeekType,
} from "@picksleagues/schemas";
import { getLeagueWithCurrentSeason } from "../leagues/current-season";
import { rebuildLeagueSeason } from "../settlement/pickem";

/**
 * The simulator's step-through settlement (SIM-5; spec §Testing & Internal
 * Tooling; arch §Simulator & Time). A thin operator wrapper over PKM-4's
 * `rebuildLeagueSeason` — the point of this module is reading the resulting
 * `pick_results`/`standings` back out into an inspectable shape, never a
 * second settlement implementation.
 */

export type SettleForSimResult =
  | { ok: true; response: SimSettleResponse }
  | { ok: false; reason: typeof ERROR_CODE.LEAGUE_NOT_FOUND };

/** A league season this call will rebuild, with the identity fields the response needs. */
interface SettleTarget {
  leagueId: string;
  leagueName: string;
  leagueSeasonId: string;
  seasonYear: number;
}

/**
 * Every active Pick'em league season — the "omitted `leagueId`" scope,
 * mirroring `settleSweep`. Filtered to Pick'em because settlement only grades
 * that mode today: including the others would render them as empty boards with
 * a zero summary, which reads to an operator as "settled and found nothing"
 * rather than "not settleable yet". ELM-4/MM-6 widen this with their modes.
 */
async function loadActiveTargets(db: Db): Promise<SettleTarget[]> {
  return db
    .select({
      leagueId: leagues.id,
      leagueName: leagues.name,
      leagueSeasonId: leagueSeasons.id,
      seasonYear: sportSeasons.year,
    })
    .from(leagueSeasons)
    .innerJoin(leagues, eq(leagues.id, leagueSeasons.leagueId))
    .innerJoin(sportSeasons, eq(sportSeasons.id, leagueSeasons.seasonId))
    .where(
      and(eq(leagueSeasons.status, LEAGUE_STATUS.ACTIVE), eq(leagues.mode, LEAGUE_MODE.PICKEM)),
    );
}

/** One league's standings rows at a given scope — `weekId: null` reads the season board. */
async function loadStandingsRows(
  db: Db,
  leagueSeasonId: string,
  weekId: string | null,
): Promise<SimSettleStandingsRow[]> {
  const rows = await db
    .select({
      leagueMemberId: standings.leagueMemberId,
      username: users.username,
      displayName: users.display_name,
      points: standings.points,
      differential: standings.differential,
      rank: standings.rank,
    })
    .from(standings)
    .innerJoin(leagueMembers, eq(leagueMembers.id, standings.leagueMemberId))
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .where(
      and(
        eq(standings.leagueSeasonId, leagueSeasonId),
        weekId === null ? isNull(standings.weekId) : eq(standings.weekId, weekId),
      ),
    )
    .orderBy(asc(standings.rank), asc(users.display_name));
  return rows;
}

/** The weeks a rebuild actually produced a board for, ordered by week start. */
async function loadSettledWeeks(
  db: Db,
  leagueSeasonId: string,
): Promise<Array<{ weekId: string; label: string; weekType: WeekType; weekNumber: number }>> {
  return db
    .select({
      weekId: weeks.id,
      label: weeks.label,
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
    })
    .from(weeks)
    .innerJoin(standings, eq(standings.weekId, weeks.id))
    .where(eq(standings.leagueSeasonId, leagueSeasonId))
    .groupBy(weeks.id)
    .orderBy(asc(weeks.startsAt));
}

/** `pick_results` row counts per week for this league season, for the weekly `results` count. */
async function loadResultCountsByWeek(
  db: Db,
  leagueSeasonId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ weekId: pickResults.weekId, resultCount: count() })
    .from(pickResults)
    .where(eq(pickResults.leagueSeasonId, leagueSeasonId))
    .groupBy(pickResults.weekId);
  return new Map(rows.map((row) => [row.weekId, row.resultCount]));
}

/** Rebuilds one league season, then reads its stored standings/results back into the wire shape. */
async function settleTarget(
  db: Db,
  clock: Clock,
  target: SettleTarget,
): Promise<SimSettleLeagueResult> {
  const summary = await rebuildLeagueSeason(db, clock, target.leagueSeasonId);

  const [seasonStandings, weekMeta, resultCounts] = await Promise.all([
    loadStandingsRows(db, target.leagueSeasonId, null),
    loadSettledWeeks(db, target.leagueSeasonId),
    loadResultCountsByWeek(db, target.leagueSeasonId),
  ]);

  const weeksOut = await Promise.all(
    weekMeta.map(async (week) => ({
      weekId: week.weekId,
      label: week.label,
      weekType: week.weekType,
      weekNumber: week.weekNumber,
      results: resultCounts.get(week.weekId) ?? 0,
      standings: await loadStandingsRows(db, target.leagueSeasonId, week.weekId),
    })),
  );

  return {
    leagueId: target.leagueId,
    leagueName: target.leagueName,
    leagueSeasonId: target.leagueSeasonId,
    seasonYear: target.seasonYear,
    summary,
    seasonStandings,
    weeks: weeksOut,
  };
}

export async function settleForSim(
  db: Db,
  clock: Clock,
  request: SimSettleRequest,
): Promise<SettleForSimResult> {
  let targets: SettleTarget[];
  if (request.leagueId) {
    const current = await getLeagueWithCurrentSeason(db, request.leagueId);
    if (!current) return { ok: false, reason: ERROR_CODE.LEAGUE_NOT_FOUND };
    targets = [
      {
        leagueId: current.league.id,
        leagueName: current.league.name,
        leagueSeasonId: current.season.id,
        seasonYear: current.season.seasonYear,
      },
    ];
  } else {
    targets = await loadActiveTargets(db);
  }

  // Sequential, one transaction per league season (settleSweep's own idiom) —
  // one league's rebuild must not roll back alongside another's.
  const leagueResults: SimSettleLeagueResult[] = [];
  for (const target of targets) {
    leagueResults.push(await settleTarget(db, clock, target));
  }
  leagueResults.sort((a, b) => a.leagueName.localeCompare(b.leagueName));

  return {
    ok: true,
    response: {
      settledAt: clock.now().toISOString(),
      leagues: leagueResults,
    },
  };
}
