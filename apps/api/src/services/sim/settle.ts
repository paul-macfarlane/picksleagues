import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  leagueMembers,
  leagues,
  leagueSeasons,
  pickemPickResults,
  pickemStandings,
  sportSeasons,
  survivorPickResults,
  survivorState,
  users,
  weeks,
} from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ERROR_CODE,
  LEAGUE_MODE,
  LEAGUE_STATUS,
  SURVIVOR_MEMBER_STATUS,
  nflSeasonOrdinal,
  toNflWeekRef,
  type LeagueMode,
  type SimSettleBoard,
  type SimSettleLeagueResult,
  type SimSettleRequest,
  type SimSettleResponse,
  type SimSettlePickemStandingsRow,
  type SimSettleSurvivorMemberRow,
  type WeekType,
} from "@picksleagues/schemas";
import { getLeagueWithCurrentSeason } from "../leagues/current-season";
import { rebuildLeagueSeason } from "../settlement";

/**
 * The simulator's step-through settlement (SIM-5; spec §Testing & Internal
 * Tooling; arch §Simulator & Time). A thin operator wrapper over the
 * mode-dispatching `rebuildLeagueSeason` — the point of this module is reading
 * the resulting rows back out into an inspectable shape, never a second
 * settlement implementation.
 *
 * **The read-back is dispatched on mode, exactly as the rebuild is** (SIM-10).
 * Reading `pickem_standings` whatever the mode was is what left a settled
 * Survivor season showing a real summary beside an empty board, and an operator
 * cannot tell that from a settle that graded nothing. Each mode reads back the
 * tables it actually writes (ADR-0016); a mode with no settlement module says so
 * rather than borrowing another's empty board.
 *
 * Nothing here re-derives a rule. Every number is read from what settlement just
 * stored, so a disagreement between this surface and the member-facing board is
 * a bug in one of the two readers and never a second opinion about the season.
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
  /** Chooses the board the read-back serves, and so which tables it reads. */
  mode: LeagueMode;
}

/**
 * Every active league season settlement can grade — the "omitted `leagueId`"
 * scope, mirroring `settleSweep`. Filtered to the modes that have a settlement
 * module: a March Madness season would otherwise be rebuilt to a zero summary
 * every run for no reason. MM-6 widens this with its mode.
 *
 * A season this filter skips is still reachable by naming its `leagueId`, which
 * is where the board union's "not settleable yet" arm gets served from.
 */
async function loadActiveTargets(db: Db): Promise<SettleTarget[]> {
  return db
    .select({
      leagueId: leagues.id,
      leagueName: leagues.name,
      leagueSeasonId: leagueSeasons.id,
      seasonYear: sportSeasons.year,
      mode: leagues.mode,
    })
    .from(leagueSeasons)
    .innerJoin(leagues, eq(leagues.id, leagueSeasons.leagueId))
    .innerJoin(sportSeasons, eq(sportSeasons.id, leagueSeasons.seasonId))
    .where(
      and(
        eq(leagueSeasons.status, LEAGUE_STATUS.ACTIVE),
        inArray(leagues.mode, [LEAGUE_MODE.PICKEM, LEAGUE_MODE.SURVIVOR]),
      ),
    );
}

/** One league's standings rows at a given scope — `weekId: null` reads the season board. */
async function loadStandingsRows(
  db: Db,
  leagueSeasonId: string,
  weekId: string | null,
): Promise<SimSettlePickemStandingsRow[]> {
  const rows = await db
    .select({
      leagueMemberId: pickemStandings.leagueMemberId,
      username: users.username,
      displayName: users.display_name,
      points: pickemStandings.points,
      rank: pickemStandings.rank,
    })
    .from(pickemStandings)
    .innerJoin(leagueMembers, eq(leagueMembers.id, pickemStandings.leagueMemberId))
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .where(
      and(
        eq(pickemStandings.leagueSeasonId, leagueSeasonId),
        weekId === null ? isNull(pickemStandings.weekId) : eq(pickemStandings.weekId, weekId),
      ),
    )
    .orderBy(asc(pickemStandings.rank), asc(users.display_name));
  return rows;
}

/** The weeks a Pick'em rebuild actually produced a board for, ordered by week start. */
async function loadPickemSettledWeeks(
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
    .innerJoin(pickemStandings, eq(pickemStandings.weekId, weeks.id))
    .where(eq(pickemStandings.leagueSeasonId, leagueSeasonId))
    .groupBy(weeks.id)
    .orderBy(asc(weeks.startsAt));
}

/** `pickem_pick_results` row counts per week, for the weekly `results` count. */
async function loadPickemResultCountsByWeek(
  db: Db,
  leagueSeasonId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ weekId: pickemPickResults.weekId, resultCount: count() })
    .from(pickemPickResults)
    .where(eq(pickemPickResults.leagueSeasonId, leagueSeasonId))
    .groupBy(pickemPickResults.weekId);
  return new Map(rows.map((row) => [row.weekId, row.resultCount]));
}

async function loadPickemBoard(db: Db, target: SettleTarget): Promise<SimSettleBoard> {
  const [seasonStandings, weekMeta, resultCounts] = await Promise.all([
    loadStandingsRows(db, target.leagueSeasonId, null),
    loadPickemSettledWeeks(db, target.leagueSeasonId),
    loadPickemResultCountsByWeek(db, target.leagueSeasonId),
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

  return { mode: LEAGUE_MODE.PICKEM, seasonStandings, weeks: weeksOut };
}

/**
 * Survivor's ledger for every member of the league, joined to their identity.
 *
 * A `left` join because **absence of a `survivor_state` row means alive and
 * untouched** (ADR-0025) — nothing mints one at join time, so an inner join
 * would silently drop every member the season has decided nothing about, which
 * is the whole league before the first week grades.
 */
async function loadSurvivorMembers(
  db: Db,
  target: SettleTarget,
): Promise<SimSettleSurvivorMemberRow[]> {
  const rows = await db
    .select({
      leagueMemberId: leagueMembers.id,
      username: users.username,
      displayName: users.display_name,
      eliminatedWeekId: survivorState.eliminatedWeekId,
      livesRemaining: survivorState.livesRemaining,
      revivedCount: survivorState.revivedCount,
    })
    .from(leagueMembers)
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .leftJoin(
      survivorState,
      and(
        eq(survivorState.leagueMemberId, leagueMembers.id),
        eq(survivorState.leagueSeasonId, target.leagueSeasonId),
      ),
    )
    .where(eq(leagueMembers.leagueId, target.leagueId));

  return rows
    .map((row) => ({
      leagueMemberId: row.leagueMemberId,
      username: row.username,
      displayName: row.displayName,
      status:
        row.eliminatedWeekId === null
          ? SURVIVOR_MEMBER_STATUS.ALIVE
          : SURVIVOR_MEMBER_STATUS.ELIMINATED,
      eliminatedWeekId: row.eliminatedWeekId,
      // The defaults a missing row stands for, spelled out rather than left
      // null: one life per member in the MVP (spec §Game Mode 2 — Core Rules).
      livesRemaining: row.livesRemaining ?? 1,
      revivedCount: row.revivedCount ?? 0,
    }))
    .sort(
      (a, b) =>
        Number(a.status === SURVIVOR_MEMBER_STATUS.ELIMINATED) -
          Number(b.status === SURVIVOR_MEMBER_STATUS.ELIMINATED) ||
        a.displayName.localeCompare(b.displayName) ||
        // Display names are not unique, so without a final total tiebreak two
        // runs could order the same board differently — which is exactly the
        // by-eye diffability this ordering exists to give the operator.
        a.leagueMemberId.localeCompare(b.leagueMemberId),
    );
}

/** `survivor_pick_results` row counts per week, for the weekly `results` count. */
async function loadSurvivorResultCountsByWeek(
  db: Db,
  leagueSeasonId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ weekId: survivorPickResults.weekId, resultCount: count() })
    .from(survivorPickResults)
    .where(eq(survivorPickResults.leagueSeasonId, leagueSeasonId))
    .groupBy(survivorPickResults.weekId);
  return new Map(rows.map((row) => [row.weekId, row.resultCount]));
}

async function loadSurvivorBoard(db: Db, target: SettleTarget): Promise<SimSettleBoard> {
  const [members, resultCounts] = await Promise.all([
    loadSurvivorMembers(db, target),
    loadSurvivorResultCountsByWeek(db, target.leagueSeasonId),
  ]);

  const eliminatedByWeek = new Map<string, string[]>();
  for (const member of members) {
    if (member.eliminatedWeekId === null) continue;
    const bucket = eliminatedByWeek.get(member.eliminatedWeekId);
    if (bucket) bucket.push(member.leagueMemberId);
    else eliminatedByWeek.set(member.eliminatedWeekId, [member.leagueMemberId]);
  }

  // The union of "graded something" and "put someone out" — see
  // `SimSettleSurvivorWeekResultSchema` for why those are not the same set.
  const weekIds = [...new Set([...resultCounts.keys(), ...eliminatedByWeek.keys()])];
  if (weekIds.length === 0) return { mode: LEAGUE_MODE.SURVIVOR, members, weeks: [] };

  const weekMeta = await db
    .select({
      weekId: weeks.id,
      label: weeks.label,
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
    })
    .from(weeks)
    .where(inArray(weeks.id, weekIds));

  // Sorted by the season ordinal, which is the order the replay grades in
  // (ADR-0025). Week start cannot stand in for it: two weeks may share a start
  // instant, and the ordinal is also what spans the regular/postseason boundary.
  const weeksOut = weekMeta
    .sort((a, b) => nflSeasonOrdinal(toNflWeekRef(a)) - nflSeasonOrdinal(toNflWeekRef(b)))
    .map((week) => ({
      weekId: week.weekId,
      label: week.label,
      weekType: week.weekType,
      weekNumber: week.weekNumber,
      results: resultCounts.get(week.weekId) ?? 0,
      eliminatedMemberIds: eliminatedByWeek.get(week.weekId) ?? [],
    }));

  return { mode: LEAGUE_MODE.SURVIVOR, members, weeks: weeksOut };
}

/**
 * The board for one settled league season, in its own mode's shape. The `switch`
 * is the exhaustiveness proof: adding a `LEAGUE_MODE` member without a board
 * here fails to compile rather than serving an empty one from another mode.
 */
async function loadBoard(db: Db, target: SettleTarget): Promise<SimSettleBoard> {
  switch (target.mode) {
    case LEAGUE_MODE.PICKEM:
      return loadPickemBoard(db, target);
    case LEAGUE_MODE.SURVIVOR:
      return loadSurvivorBoard(db, target);
    case LEAGUE_MODE.MARCH_MADNESS:
      // `rebuildLeagueSeason` has no module for this mode and returns an empty
      // summary, so there is nothing stored to read back (MM-6).
      return { mode: LEAGUE_MODE.MARCH_MADNESS };
  }
}

/** Rebuilds one league season, then reads its stored state back into the wire shape. */
async function settleTarget(
  db: Db,
  clock: Clock,
  target: SettleTarget,
): Promise<SimSettleLeagueResult> {
  const summary = await rebuildLeagueSeason(db, clock, target.leagueSeasonId);

  return {
    leagueId: target.leagueId,
    leagueName: target.leagueName,
    leagueSeasonId: target.leagueSeasonId,
    seasonYear: target.seasonYear,
    summary,
    board: await loadBoard(db, target),
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
        mode: current.league.mode,
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
