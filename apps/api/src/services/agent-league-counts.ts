import { and, count, eq, isNull, max, ne, or, sql, type SQL } from "drizzle-orm";
import {
  games,
  leagueMembers,
  pickemPicks,
  pickemPickResults,
  pickemStandings,
  survivorPicks,
  survivorPickResults,
  survivorState,
  weeks,
  type Db,
} from "@picksleagues/db";
import { GAME_STATUS } from "@picksleagues/schemas";

/** Only technical scope identifiers enter diagnostic queries; identities never leave SQL. */
type Scope = { leagueSeasonId: string; leagueId: string; seasonId: string };

const filteredCount = (predicate: SQL) =>
  sql<number>`count(*) filter (where ${predicate})`.mapWith(Number);

// Both modes share these relational checks. Mode-specific state and pick rules
// stay in the two callers instead of conditional table/column-name strings.
function pickCounts(
  db: Db,
  scope: Scope,
  picks: typeof pickemPicks | typeof survivorPicks,
  results: typeof pickemPickResults | typeof survivorPickResults,
  resultPickId: typeof pickemPickResults.pickemPickId | typeof survivorPickResults.survivorPickId,
  duplicateKey: SQL[],
  invalidPick: SQL,
) {
  const mismatchedResult = or(
    ne(results.leagueSeasonId, picks.leagueSeasonId),
    ne(results.leagueMemberId, picks.leagueMemberId),
    ne(results.weekId, picks.weekId),
  )!;
  const pick = db
    .select({
      submittedPickCount: count().as("submitted_pick_count"),
      ungradedPickCount: filteredCount(isNull(resultPickId)).as("ungraded_pick_count"),
      ungradedResolvedPickCount: filteredCount(
        and(
          isNull(resultPickId),
          or(
            eq(games.status, GAME_STATUS.CANCELLED),
            and(
              eq(games.status, GAME_STATUS.FINAL),
              sql`${games.homeScore} is not null`,
              sql`${games.awayScore} is not null`,
            ),
          ),
        )!,
      ).as("ungraded_resolved_pick_count"),
      inconsistentPickCount: filteredCount(
        or(
          ne(games.weekId, picks.weekId),
          ne(weeks.seasonId, scope.seasonId),
          ne(leagueMembers.leagueId, scope.leagueId),
          invalidPick,
        )!,
      ).as("inconsistent_pick_count"),
      // The other half of the mismatch check starts from this season's picks.
      // Excluding this season's results keeps the two anchored scans disjoint.
      incomingMismatchCount: filteredCount(
        and(ne(results.leagueSeasonId, scope.leagueSeasonId), mismatchedResult)!,
      ).as("incoming_mismatch_count"),
      updatedAt: max(picks.updatedAt).as("pick_updated_at"),
    })
    .from(picks)
    .innerJoin(games, eq(games.id, picks.gameId))
    .innerJoin(weeks, eq(weeks.id, picks.weekId))
    .innerJoin(leagueMembers, eq(leagueMembers.id, picks.leagueMemberId))
    .leftJoin(results, eq(resultPickId, picks.id))
    .where(eq(picks.leagueSeasonId, scope.leagueSeasonId))
    .as("pick_summary");
  const result = db
    .select({
      gradedPickCount: count().as("graded_pick_count"),
      outgoingMismatchCount: filteredCount(mismatchedResult).as("outgoing_mismatch_count"),
      updatedAt: max(results.settledAt).as("result_updated_at"),
    })
    .from(results)
    .innerJoin(picks, eq(picks.id, resultPickId))
    .where(eq(results.leagueSeasonId, scope.leagueSeasonId))
    .as("result_summary");
  const duplicates = db
    .select({ excess: sql<number>`count(*) - 1`.as("excess") })
    .from(picks)
    .where(eq(picks.leagueSeasonId, scope.leagueSeasonId))
    .groupBy(...duplicateKey)
    .having(sql`count(*) > 1`)
    .as("duplicate_picks");
  const duplicate = db
    .select({
      count: sql<number>`coalesce(sum(${duplicates.excess}), 0)`
        .mapWith(Number)
        .as("duplicate_count"),
    })
    .from(duplicates)
    .as("duplicate_summary");
  return { pick, result, duplicate };
}

function pickFields({ pick, result, duplicate }: ReturnType<typeof pickCounts>) {
  return {
    submittedPickCount: pick.submittedPickCount,
    gradedPickCount: result.gradedPickCount,
    ungradedPickCount: pick.ungradedPickCount,
    ungradedResolvedPickCount: pick.ungradedResolvedPickCount,
    duplicateRowCount: duplicate.count,
  };
}

/** Pick'em compares cumulative standings with one grouped result total per member. */
export function agentPickemCountsQuery(db: Db, scope: Scope, againstSpread: boolean) {
  const counts = pickCounts(
    db,
    scope,
    pickemPicks,
    pickemPickResults,
    pickemPickResults.pickemPickId,
    [sql`${pickemPicks.leagueMemberId}`, sql`${pickemPicks.weekId}`, sql`${pickemPicks.gameId}`],
    againstSpread ? isNull(pickemPicks.spreadAtPick) : sql`false`,
  );
  const totals = db
    .select({
      memberId: pickemPickResults.leagueMemberId,
      points: sql<number>`sum(${pickemPickResults.points})`.as("member_total_points"),
    })
    .from(pickemPickResults)
    .where(eq(pickemPickResults.leagueSeasonId, scope.leagueSeasonId))
    .groupBy(pickemPickResults.leagueMemberId)
    .as("member_totals");
  const state = db
    .select({
      standingStateRowCount: count().as("state_row_count"),
      inconsistentStateCount: filteredCount(
        or(
          ne(leagueMembers.leagueId, scope.leagueId),
          sql`${pickemStandings.points} <> coalesce(${totals.points}, 0)`,
        )!,
      ).as("inconsistent_state_count"),
      updatedAt: max(pickemStandings.updatedAt).as("state_updated_at"),
    })
    .from(pickemStandings)
    .innerJoin(leagueMembers, eq(leagueMembers.id, pickemStandings.leagueMemberId))
    .leftJoin(totals, eq(totals.memberId, pickemStandings.leagueMemberId))
    .where(
      and(eq(pickemStandings.leagueSeasonId, scope.leagueSeasonId), isNull(pickemStandings.weekId)),
    )
    .as("state_summary");
  const missing = db
    .select({ count: count().as("missing_count") })
    .from(leagueMembers)
    .leftJoin(
      pickemStandings,
      and(
        eq(pickemStandings.leagueMemberId, leagueMembers.id),
        eq(pickemStandings.leagueSeasonId, scope.leagueSeasonId),
        isNull(pickemStandings.weekId),
      ),
    )
    .where(and(eq(leagueMembers.leagueId, scope.leagueId), isNull(pickemStandings.id)))
    .as("missing_summary");
  return db
    .select({
      ...pickFields(counts),
      standingStateRowCount: state.standingStateRowCount,
      missingStandingCount:
        sql<number>`case when ${counts.result.gradedPickCount} > 0 then ${missing.count} else 0 end`.mapWith(
          Number,
        ),
      inconsistentRowCount:
        sql<number>`${counts.pick.inconsistentPickCount} + ${counts.pick.incomingMismatchCount} + ${counts.result.outgoingMismatchCount} + ${state.inconsistentStateCount}`.mapWith(
          Number,
        ),
      dataUpdatedAt: sql<
        string | null
      >`greatest(${counts.pick.updatedAt}, ${counts.result.updatedAt}, ${state.updatedAt})`,
    })
    .from(counts.pick)
    .crossJoin(counts.result)
    .crossJoin(counts.duplicate)
    .crossJoin(state)
    .crossJoin(missing);
}

/** Missing Survivor state is normally alive, so only contradictory stored state is flagged. */
export function agentSurvivorCountsQuery(db: Db, scope: Scope) {
  const counts = pickCounts(
    db,
    scope,
    survivorPicks,
    survivorPickResults,
    survivorPickResults.survivorPickId,
    [sql`${survivorPicks.leagueMemberId}`, sql`${survivorPicks.weekId}`],
    sql`false`,
  );
  const state = db
    .select({
      standingStateRowCount: count().as("state_row_count"),
      inconsistentStateCount: filteredCount(
        or(
          ne(leagueMembers.leagueId, scope.leagueId),
          and(isNull(survivorState.eliminatedWeekId), ne(survivorState.livesRemaining, 1)),
          and(
            sql`${survivorState.eliminatedWeekId} is not null`,
            ne(survivorState.livesRemaining, 0),
          ),
        )!,
      ).as("inconsistent_state_count"),
      updatedAt: max(survivorState.updatedAt).as("state_updated_at"),
    })
    .from(survivorState)
    .innerJoin(leagueMembers, eq(leagueMembers.id, survivorState.leagueMemberId))
    .where(eq(survivorState.leagueSeasonId, scope.leagueSeasonId))
    .as("state_summary");
  return db
    .select({
      ...pickFields(counts),
      standingStateRowCount: state.standingStateRowCount,
      missingStandingCount: sql<number>`0`.mapWith(Number),
      inconsistentRowCount:
        sql<number>`${counts.pick.inconsistentPickCount} + ${counts.pick.incomingMismatchCount} + ${counts.result.outgoingMismatchCount} + ${state.inconsistentStateCount}`.mapWith(
          Number,
        ),
      dataUpdatedAt: sql<
        string | null
      >`greatest(${counts.pick.updatedAt}, ${counts.result.updatedAt}, ${state.updatedAt})`,
    })
    .from(counts.pick)
    .crossJoin(counts.result)
    .crossJoin(counts.duplicate)
    .crossJoin(state);
}
