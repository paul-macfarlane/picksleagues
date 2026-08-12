import { and, count, eq, inArray, max } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  adminAudit,
  games,
  leagueMembers,
  leagueSeasons,
  leagues,
  pickemPickResults,
  pickemPicks,
  pickemStandings,
  weeks,
} from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  GAME_STATUS,
  isUnplayedStatus,
  isWeekInSeasonRange,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  type PickemSettings,
} from "@picksleagues/schemas";
import {
  aggregateStandings,
  PICKEM_UNSETTLED_REASON,
  rankStandings,
  settlePickemWeek,
  type PickemGameResult,
  type PickemPickInput,
  type ScoredOutcome,
} from "@picksleagues/scoring";
import { resolveGameOverrides } from "../games";
import { applyLeagueSeasonConclusion } from "../leagues/conclusion";
import { lockLeagueSeasonRow } from "../leagues/locks";
import { logInfo } from "../../lib/logger";
import { addSummary, EMPTY_SUMMARY, type SettlementSummary } from "../settlement";

/**
 * Pick'em settlement orchestration (arch D10, §Settlement & Scoring): load
 * inputs → pure functions → persist `pickem_pick_results` and rebuild
 * `pickem_standings`, all in one transaction. Reached through the mode dispatch
 * in `services/settlement.ts`, never called directly by a job or route.
 *
 * Everything here is a **pure derivation** and is written delete-then-insert
 * rather than diffed, which is what makes it idempotent: settling the same week
 * twice, or rebuilding a whole season, lands on byte-identical state. The
 * incremental path (a game going final) is only an optimization over the
 * nightly sweep — never a source of state a rebuild couldn't reproduce.
 *
 * A Pick'em week settles in isolation, against its own games and nothing else.
 * That is what lets the entry points below take an arbitrary set of weeks, and
 * it is exactly what Survivor cannot do (ADR-0025).
 */

/** A league season eligible for settlement, with its settings already parsed. */
interface SettleableSeason {
  leagueSeasonId: string;
  leagueId: string;
  seasonId: string;
  settings: PickemSettings;
}

async function loadSettleableSeason(
  db: Db,
  leagueSeasonId: string,
): Promise<SettleableSeason | null> {
  const [row] = await db
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
  // Other modes settle through their own module into their own tables
  // (ADR-0016); this one grades Pick'em picks only. Re-checked here rather than
  // trusted from the dispatcher, so a direct caller can't grade the wrong mode.
  if (!row || row.mode !== LEAGUE_MODE.PICKEM) return null;

  return {
    leagueSeasonId: row.leagueSeasonId,
    leagueId: row.leagueId,
    seasonId: row.seasonId,
    // Parsed, never trusted — defaults must materialize before they reach
    // scoring (engineering rules §Data).
    settings: LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM].parse(row.settings),
  };
}

/**
 * Whether the league's whole range has played out — Pick'em's arm of the
 * conclusion rule (ADR-0030).
 *
 * **Independent of picks, deliberately.** The spec gives Pick'em no §End of
 * League of its own; its season is its start week through its end week (spec
 * §Standings), and a league nobody ever submitted a pick in still has to end.
 * Keying on results would leave such a league running forever.
 *
 * A `final` game with no score is a provider fault an admin override fixes, and
 * it holds the season open until one does — the same bar the grader applies to
 * the pick on it, so conclusion can't outrun the results it describes.
 *
 * **The range is the in-range `weeks` rows that exist**, not the ordinal span
 * the settings name — a week the range covers but that was never ingested is not
 * waited for. Both settlement replays already read the range that way, and season
 * setup creates a season's weeks wholesale, so the two coincide; a season built
 * piecemeal would conclude on a partial universe.
 */
async function rangePlayedOut(tx: Db, season: SettleableSeason): Promise<boolean> {
  const weekRows = await tx
    .select({ id: weeks.id, weekType: weeks.weekType, weekNumber: weeks.weekNumber })
    .from(weeks)
    .where(eq(weeks.seasonId, season.seasonId));
  const inRangeWeekIds = weekRows
    .filter((row) => isWeekInSeasonRange(row, season.settings))
    .map((row) => row.id);

  // No in-range week at all is a league whose schedule hasn't been ingested, not
  // a season that finished instantly — the same reading the settlement replays
  // give an empty week.
  if (inRangeWeekIds.length === 0) return false;

  // Scoped to the weeks the league plays rather than the whole season: this runs
  // on the 5-minute incremental path, inside the transaction holding the
  // league-season lock, and a mid-season-created league has no business loading
  // eighteen weeks of regular-season games to answer it.
  const gameRows = await tx.select().from(games).where(inArray(games.weekId, inRangeWeekIds));

  const gamesByWeek = new Map<string, Array<typeof games.$inferSelect>>(
    inRangeWeekIds.map((weekId) => [weekId, []]),
  );
  for (const row of gameRows) gamesByWeek.get(row.weekId)?.push(row);

  return [...gamesByWeek.values()].every((weekGames) => {
    // A week with no games is a week the schedule never filled, not a week that
    // finished with nothing to play.
    if (weekGames.length === 0) return false;
    return weekGames.every((row) => {
      const effective = resolveGameOverrides(row);
      // Cancelled counts as done — it will never be played and the spec already
      // resolves the pick on it as a push (spec §Cancellations & Postponements).
      if (isUnplayedStatus(effective.status)) return true;
      return (
        effective.status === GAME_STATUS.FINAL &&
        effective.homeScore !== null &&
        effective.awayScore !== null
      );
    });
  });
}

/**
 * Builds the pure functions' inputs for one league-week, resolving the one
 * thing only this layer knows about: **override precedence**
 * (`override_* ?? provider_*`, arch D15), via the one home for it.
 *
 * Games are loaded by `pick.gameId`, never by week. A pick's game therefore
 * always grades by its own status, with no week comparison — week moves are out
 * of scope (ADR-0019) and a real one is corrected by an admin `cancelled`
 * override, which this coalesce already honours.
 */
async function loadWeekInputs(
  tx: Db,
  leagueSeasonId: string,
  weekId: string,
): Promise<{ picks: PickemPickInput[]; results: PickemGameResult[] }> {
  const picks = await tx
    .select()
    .from(pickemPicks)
    .where(and(eq(pickemPicks.leagueSeasonId, leagueSeasonId), eq(pickemPicks.weekId, weekId)));
  if (picks.length === 0) return { picks: [], results: [] };

  const gameRows = await tx
    .select()
    .from(games)
    .where(inArray(games.id, [...new Set(picks.map((pick) => pick.gameId))]));

  const results: PickemGameResult[] = gameRows.map((game) => {
    const effective = resolveGameOverrides(game);
    return {
      gameId: game.id,
      status: effective.status,
      homeScore: effective.homeScore,
      awayScore: effective.awayScore,
    };
  });

  return {
    picks: picks.map((pick) => ({
      pickId: pick.id,
      memberId: pick.leagueMemberId,
      gameId: pick.gameId,
      side: pick.side,
      spreadAtPick: pick.spreadAtPick,
    })),
    results,
  };
}

/** Replaces one league-week's `pickem_pick_results`. Standings are rebuilt separately. */
async function settleWeekResults(
  tx: Db,
  clock: Clock,
  season: SettleableSeason,
  weekId: string,
): Promise<{ results: number; unsettled: number }> {
  const { picks, results } = await loadWeekInputs(tx, season.leagueSeasonId, weekId);

  const settlement = settlePickemWeek(picks, results, {
    pickType: season.settings.pickType,
  });

  // Delete-then-insert, not upsert: a pick that stopped being settleable (its
  // game reverted to scheduled, or an override cleared a score) must lose its
  // row, which a diff-based write would leave stranded.
  await tx
    .delete(pickemPickResults)
    .where(
      and(
        eq(pickemPickResults.leagueSeasonId, season.leagueSeasonId),
        eq(pickemPickResults.weekId, weekId),
      ),
    );

  if (settlement.outcomes.length > 0) {
    const settledAt = clock.now();
    await tx.insert(pickemPickResults).values(
      settlement.outcomes.map((outcome) => ({
        pickemPickId: outcome.pickId,
        leagueSeasonId: season.leagueSeasonId,
        leagueMemberId: outcome.memberId,
        weekId,
        outcome: outcome.outcome,
        points: outcome.points,
        settledAt,
      })),
    );
  }

  for (const pick of settlement.unsettled) {
    // A final game with no score is a provider fault an admin override fixes —
    // worth a log line, unlike the ordinary not-yet-played case.
    if (pick.reason !== PICKEM_UNSETTLED_REASON.NOT_YET_PLAYED) {
      logInfo("settlement.unsettleable-pick", {
        leagueSeasonId: season.leagueSeasonId,
        weekId,
        gameId: pick.gameId,
        reason: pick.reason,
      });
    }
  }

  return { results: settlement.outcomes.length, unsettled: settlement.unsettled.length };
}

/**
 * Recomputes every standings row for a league season from its stored
 * `pickem_pick_results` — both the weekly boards and the cumulative season board
 * (spec §Standings). Rebuilt wholesale so the output can't drift from the
 * results it derives from.
 */
async function rebuildStandings(tx: Db, clock: Clock, season: SettleableSeason): Promise<void> {
  const members = await tx
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, season.leagueId));
  const memberIds = members.map((member) => member.id);

  const results = await tx
    .select({
      leagueMemberId: pickemPickResults.leagueMemberId,
      weekId: pickemPickResults.weekId,
      outcome: pickemPickResults.outcome,
      points: pickemPickResults.points,
    })
    .from(pickemPickResults)
    .where(eq(pickemPickResults.leagueSeasonId, season.leagueSeasonId));

  // Seeded from the weeks that have *picks*, not just the weeks that have
  // results: an in-progress week would otherwise get no board at all, and the
  // season board is already written even when empty precisely so the UI never
  // has to special-case a missing one.
  const byWeek = new Map<string, ScoredOutcome[]>(
    (await weeksWithPicks(tx, season.leagueSeasonId)).map((weekId) => [weekId, []]),
  );
  const seasonOutcomes: ScoredOutcome[] = [];
  for (const result of results) {
    const outcome: ScoredOutcome = {
      memberId: result.leagueMemberId,
      outcome: result.outcome,
      points: result.points,
    };
    seasonOutcomes.push(outcome);
    const bucket = byWeek.get(result.weekId);
    if (bucket) bucket.push(outcome);
    else byWeek.set(result.weekId, [outcome]);
  }

  const updatedAt = clock.now();
  const rows: Array<typeof pickemStandings.$inferInsert> = [...byWeek.entries()].flatMap(
    ([weekId, outcomes]) =>
      rankStandings(aggregateStandings(outcomes, memberIds)).map((entry) => ({
        leagueSeasonId: season.leagueSeasonId,
        leagueMemberId: entry.memberId,
        weekId,
        points: entry.points,
        // Recounted from the stored results on every rebuild, never
        // incremented — the W/L/P counts are part of the same pure derivation
        // as points and rank (arch D10).
        wins: entry.wins,
        losses: entry.losses,
        pushes: entry.pushes,
        rank: entry.rank,
        updatedAt,
      })),
  );

  // The season board is written even with no results at all, so a league that
  // hasn't played yet still has a board (everyone level on zero) rather than an
  // empty one the UI would have to special-case.
  rows.push(
    ...rankStandings(aggregateStandings(seasonOutcomes, memberIds)).map((entry) => ({
      leagueSeasonId: season.leagueSeasonId,
      leagueMemberId: entry.memberId,
      weekId: null,
      points: entry.points,
      wins: entry.wins,
      losses: entry.losses,
      pushes: entry.pushes,
      rank: entry.rank,
      updatedAt,
    })),
  );

  await tx.delete(pickemStandings).where(eq(pickemStandings.leagueSeasonId, season.leagueSeasonId));
  if (rows.length > 0) await tx.insert(pickemStandings).values(rows);
}

/** Weeks this season has picks in — the only weeks a rebuild has work for. */
async function weeksWithPicks(db: Db, leagueSeasonId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ weekId: pickemPicks.weekId })
    .from(pickemPicks)
    .where(eq(pickemPicks.leagueSeasonId, leagueSeasonId));
  return rows.map((row) => row.weekId);
}

/**
 * Records an admin's rebuild against the league season whose derived state it
 * is about to replace (engineering rules §Data: "every override/rebuild writes
 * `admin_audit`").
 *
 * The prior value is a summary, not the rows: those are a whole season of a
 * derivation arch D10 already defines as reproducible from (picks, results,
 * settings), while what the trail must answer — what stood here, and when it
 * last settled — is exactly what counts plus last-write instants answer, at
 * constant size.
 */
async function recordRebuildAudit(
  tx: Db,
  clock: Clock,
  leagueSeasonId: string,
  adminUserId: string,
): Promise<void> {
  const [results] = await tx
    .select({ rows: count(), lastSettledAt: max(pickemPickResults.settledAt) })
    .from(pickemPickResults)
    .where(eq(pickemPickResults.leagueSeasonId, leagueSeasonId));
  const [standings] = await tx
    .select({ rows: count(), lastUpdatedAt: max(pickemStandings.updatedAt) })
    .from(pickemStandings)
    .where(eq(pickemStandings.leagueSeasonId, leagueSeasonId));

  await tx.insert(adminAudit).values({
    adminUserId,
    action: ADMIN_AUDIT_ACTION.LEAGUE_REBUILD,
    targetTable: ADMIN_AUDIT_TARGET_TABLE.LEAGUE_SEASONS,
    targetId: leagueSeasonId,
    priorValue: {
      resultCount: results?.rows ?? 0,
      standingsRowCount: standings?.rows ?? 0,
      lastSettledAt: results?.lastSettledAt?.toISOString() ?? null,
      lastStandingsUpdatedAt: standings?.lastUpdatedAt?.toISOString() ?? null,
    },
    createdAt: clock.now(),
  });
}

/**
 * Settles the named weeks of one league season and rebuilds its standings, in
 * one transaction. Standings are rebuilt once at the end rather than per week —
 * they are a whole-season derivation either way.
 *
 * `audit` names the admin who asked for this recompute, and is supplied only by
 * the admin rebuild endpoint: the nightly sweep, ingestion, and the simulator
 * settle on their own schedule rather than on an operator's instruction, and a
 * row per active season per night would bury the admin actions `admin_audit`
 * exists to surface.
 */
export async function settlePickemLeagueSeasonWeeks(
  db: Db,
  clock: Clock,
  leagueSeasonId: string,
  weekIds: readonly string[],
  audit?: { adminUserId: string },
): Promise<SettlementSummary> {
  const season = await loadSettleableSeason(db, leagueSeasonId);
  // Nothing here is settleable, so nothing is wiped and there is no prior value
  // to record honestly — an audited no-op would claim a recompute that never ran.
  if (!season) return EMPTY_SUMMARY;

  return db.transaction(async (tx) => {
    // Ahead of every write: the incremental, nightly, rebuild, and sim paths
    // can all settle the same season at once, and delete-then-insert without
    // this collides on the unique constraints.
    await lockLeagueSeasonRow(tx, leagueSeasonId);

    // Under the lock and before the first delete, so the recorded prior state is
    // the one this transaction replaces and no concurrent settle can shift it.
    if (audit) await recordRebuildAudit(tx, clock, leagueSeasonId, audit.adminUserId);

    let results = 0;
    let unsettled = 0;
    for (const weekId of weekIds) {
      const settled = await settleWeekResults(tx, clock, season, weekId);
      results += settled.results;
      unsettled += settled.unsettled;
    }
    await rebuildStandings(tx, clock, season);

    // A whole-season question whichever weeks this call settled, so it runs on
    // the incremental path too (ADR-0030): the game that closes the range is the
    // one whose sync should retire the season, not whatever the sweep finds that
    // night.
    await applyLeagueSeasonConclusion(
      tx,
      clock,
      season.leagueSeasonId,
      await rangePlayedOut(tx, season),
    );

    return { leagueSeasons: 1, weeks: weekIds.length, results, unsettled, failed: 0 };
  });
}

/**
 * Full recompute of one Pick'em league season from scratch — the on-demand
 * rebuild. Pass `audit` when a named admin asked for it, so the recompute and
 * its `admin_audit` row commit or roll back together.
 */
export async function rebuildPickemLeagueSeason(
  db: Db,
  clock: Clock,
  leagueSeasonId: string,
  audit?: { adminUserId: string },
): Promise<SettlementSummary> {
  const weekIds = await weeksWithPicks(db, leagueSeasonId);
  return settlePickemLeagueSeasonWeeks(db, clock, leagueSeasonId, weekIds, audit);
}

/**
 * Settles every Pick'em league-week holding a pick on one of the named games.
 *
 * Scoped to the affected weeks rather than whole seasons so the 5-minute path
 * stays cheap; the nightly sweep catches anything this missed (arch D10).
 */
export async function settlePickemPicksForGames(
  db: Db,
  clock: Clock,
  gameIds: readonly string[],
): Promise<SettlementSummary> {
  if (gameIds.length === 0) return EMPTY_SUMMARY;

  const affected = await db
    .selectDistinct({
      leagueSeasonId: pickemPicks.leagueSeasonId,
      weekId: pickemPicks.weekId,
    })
    .from(pickemPicks)
    .where(inArray(pickemPicks.gameId, [...gameIds]));

  const weeksBySeason = new Map<string, string[]>();
  for (const row of affected) {
    const bucket = weeksBySeason.get(row.leagueSeasonId);
    if (bucket) bucket.push(row.weekId);
    else weeksBySeason.set(row.leagueSeasonId, [row.weekId]);
  }

  let total = EMPTY_SUMMARY;
  for (const [leagueSeasonId, weekIds] of weeksBySeason) {
    total = addSummary(
      total,
      await settlePickemLeagueSeasonWeeks(db, clock, leagueSeasonId, weekIds),
    );
  }
  return total;
}
