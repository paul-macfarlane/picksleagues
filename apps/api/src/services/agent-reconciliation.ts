import { eq, inArray } from "drizzle-orm";
import {
  games,
  leagueMembers,
  leagueSeasons,
  leagues,
  pickemPicks,
  pickemPickResults,
  pickemStandings,
  survivorPickResults,
  survivorState,
  type Db,
} from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  AgentReconciliationResponseSchema,
  AGENT_RECONCILIATION_STATUS,
  LEAGUE_MODE,
  PickemSettingsSchema,
  SurvivorSettingsSchema,
} from "@picksleagues/schemas";
import { aggregateStandings, rankStandings, settlePickemWeek } from "@picksleagues/scoring";
import { loadSurvivorReplay, resolveReleasedFlags } from "./survivor/settlement";

/** Compares semantic values only; row ids and settlement timestamps are not derived state. */
export function compareReconciliationRows<T>(
  expected: readonly T[],
  stored: readonly T[],
  key: (row: T) => string,
  equal: (expected: T, stored: T) => boolean,
) {
  const expectedByKey = new Map(expected.map((row) => [key(row), row]));
  let unexpectedCount = 0;
  let mismatchCount = 0;
  for (const row of stored) {
    const id = key(row);
    const wanted = expectedByKey.get(id);
    if (!wanted) unexpectedCount++;
    else {
      if (!equal(wanted, row)) mismatchCount++;
      expectedByKey.delete(id);
    }
  }
  return {
    expectedCount: expected.length,
    storedCount: stored.length,
    missingCount: expectedByKey.size,
    unexpectedCount,
    mismatchCount,
  };
}

/** One league-season snapshot, reduced to an allowlisted aggregate before leaving this service. */
export async function agentScoringReconciliation(db: Db, clock: Clock, leagueSeasonId: string) {
  return db.transaction(
    async (tx) => {
      const [season] = await tx
        .select({
          leagueSeasonId: leagueSeasons.id,
          leagueId: leagueSeasons.leagueId,
          seasonId: leagueSeasons.seasonId,
          settings: leagueSeasons.settings,
          mode: leagues.mode,
        })
        .from(leagueSeasons)
        .innerJoin(leagues, eq(leagues.id, leagueSeasons.leagueId))
        .where(eq(leagueSeasons.id, leagueSeasonId));
      if (!season) return null;
      const base = {
        leagueSeasonId,
        mode: season.mode,
        checkedAt: clock.now().toISOString(),
        status: AGENT_RECONCILIATION_STATUS.CHECKED,
        results: null,
        standings: null,
        survivorState: null,
        releasedFlagMismatchCount: null,
      };
      if (season.mode === LEAGUE_MODE.PICKEM) {
        const settings = PickemSettingsSchema.parse(season.settings);
        const picks = await tx
          .select({
            id: pickemPicks.id,
            weekId: pickemPicks.weekId,
            memberId: pickemPicks.leagueMemberId,
            gameId: pickemPicks.gameId,
            side: pickemPicks.side,
            spreadAtPick: pickemPicks.spreadAtPick,
          })
          .from(pickemPicks)
          .where(eq(pickemPicks.leagueSeasonId, leagueSeasonId));
        const gameIds = [...new Set(picks.map((pick) => pick.gameId))];
        const gameRows = gameIds.length
          ? await tx
              .select({
                gameId: games.id,
                status: games.status,
                homeScore: games.homeScore,
                awayScore: games.awayScore,
              })
              .from(games)
              .where(inArray(games.id, gameIds))
          : [];
        // Pick'em grades each pick independently. Grouping all weeks here preserves its per-pick rules.
        const expected = settlePickemWeek(
          picks.map((pick) => ({ ...pick, pickId: pick.id })),
          gameRows,
          settings,
        ).outcomes;
        const weekByPick = new Map(picks.map((pick) => [pick.id, pick.weekId]));
        const expectedResults = expected.map((row) => ({
          ...row,
          weekId: weekByPick.get(row.pickId)!,
        }));
        const stored = await tx
          .select({
            pickId: pickemPickResults.pickemPickId,
            memberId: pickemPickResults.leagueMemberId,
            weekId: pickemPickResults.weekId,
            outcome: pickemPickResults.outcome,
            points: pickemPickResults.points,
          })
          .from(pickemPickResults)
          .where(eq(pickemPickResults.leagueSeasonId, leagueSeasonId));
        const results = compareReconciliationRows(
          expectedResults,
          stored,
          (row) => row.pickId,
          (a, b) =>
            a.memberId === b.memberId &&
            a.weekId === b.weekId &&
            a.outcome === b.outcome &&
            a.points === b.points,
        );
        const members = await tx
          .select({ id: leagueMembers.id })
          .from(leagueMembers)
          .where(eq(leagueMembers.leagueId, season.leagueId));
        const memberIds = members.map((row) => row.id);
        const byWeek = new Map<string, typeof expectedResults>(
          [...new Set(picks.map((p) => p.weekId))].map((id) => [id, []]),
        );
        for (const result of expectedResults) byWeek.get(result.weekId)!.push(result);
        const expectedStandings = [...byWeek].flatMap(([weekId, outcomes]) =>
          rankStandings(aggregateStandings(outcomes, memberIds)).map((row) => ({
            ...row,
            weekId: weekId as string | null,
          })),
        );
        expectedStandings.push(
          ...rankStandings(aggregateStandings(expectedResults, memberIds)).map((row) => ({
            ...row,
            weekId: null,
          })),
        );
        const storedStandings = await tx
          .select({
            memberId: pickemStandings.leagueMemberId,
            weekId: pickemStandings.weekId,
            points: pickemStandings.points,
            wins: pickemStandings.wins,
            losses: pickemStandings.losses,
            pushes: pickemStandings.pushes,
            rank: pickemStandings.rank,
          })
          .from(pickemStandings)
          .where(eq(pickemStandings.leagueSeasonId, leagueSeasonId));
        const standings = compareReconciliationRows(
          expectedStandings,
          storedStandings,
          (row) => `${row.memberId}:${row.weekId ?? "season"}`,
          (a, b) =>
            a.points === b.points &&
            a.wins === b.wins &&
            a.losses === b.losses &&
            a.pushes === b.pushes &&
            a.rank === b.rank,
        );
        return AgentReconciliationResponseSchema.parse({ ...base, results, standings });
      }
      if (season.mode === LEAGUE_MODE.SURVIVOR) {
        const { replay, picks, seasonWeeks, memberIds } = await loadSurvivorReplay(tx, clock, {
          ...season,
          settings: SurvivorSettingsSchema.parse(season.settings),
        });
        const expectedResults = replay.resultRows.map((row) => ({
          pickId: row.survivorPickId,
          memberId: row.leagueMemberId,
          weekId: row.weekId,
          outcome: row.outcome,
        }));
        const stored = await tx
          .select({
            pickId: survivorPickResults.survivorPickId,
            memberId: survivorPickResults.leagueMemberId,
            weekId: survivorPickResults.weekId,
            outcome: survivorPickResults.outcome,
          })
          .from(survivorPickResults)
          .where(eq(survivorPickResults.leagueSeasonId, leagueSeasonId));
        const results = compareReconciliationRows(
          expectedResults,
          stored,
          (row) => row.pickId,
          (a, b) => a.memberId === b.memberId && a.weekId === b.weekId && a.outcome === b.outcome,
        );
        const expectedState = memberIds.flatMap((memberId) => {
          const eliminatedWeekId = replay.eliminatedWeekByMember.get(memberId) ?? null;
          const revivedCount = replay.revivedCountByMember.get(memberId) ?? 0;
          return eliminatedWeekId === null && revivedCount === 0
            ? []
            : [
                {
                  memberId,
                  eliminatedWeekId,
                  revivedCount,
                  livesRemaining: eliminatedWeekId === null ? 1 : 0,
                },
              ];
        });
        const storedState = await tx
          .select({
            memberId: survivorState.leagueMemberId,
            eliminatedWeekId: survivorState.eliminatedWeekId,
            revivedCount: survivorState.revivedCount,
            livesRemaining: survivorState.livesRemaining,
          })
          .from(survivorState)
          .where(eq(survivorState.leagueSeasonId, leagueSeasonId));
        const state = compareReconciliationRows(
          expectedState,
          storedState,
          (row) => row.memberId,
          (a, b) =>
            a.eliminatedWeekId === b.eliminatedWeekId &&
            a.revivedCount === b.revivedCount &&
            a.livesRemaining === b.livesRemaining,
        );
        const released = resolveReleasedFlags(
          picks,
          replay.consumedByPickId,
          new Map(seasonWeeks.map((week) => [week.id, week.ordinal])),
        );
        return AgentReconciliationResponseSchema.parse({
          ...base,
          results,
          survivorState: state,
          releasedFlagMismatchCount: picks.filter((pick) => pick.released !== released.get(pick.id))
            .length,
        });
      }
      return AgentReconciliationResponseSchema.parse({
        ...base,
        status: AGENT_RECONCILIATION_STATUS.UNSUPPORTED_MODE,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
