import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  games,
  leagueMembers,
  leagueSeasons,
  leagues,
  pickemPickResults,
  pickemPicks,
  pickemStandings,
} from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  GAME_STATUS,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  LEAGUE_STATUS,
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
import { lockLeagueSeasonRow } from "../leagues/locks";
import { logError, logInfo } from "../../lib/logger";

/**
 * Settlement orchestration (arch D10, §Settlement & Scoring): load inputs →
 * pure functions → persist `pickem_pick_results` and rebuild `pickem_standings`,
 * all in one transaction.
 *
 * Everything here is a **pure derivation** and is written delete-then-insert
 * rather than diffed, which is what makes it idempotent: settling the same week
 * twice, or rebuilding a whole season, lands on byte-identical state. The
 * incremental path (a game going final) is only an optimization over the
 * nightly sweep — never a source of state a rebuild couldn't reproduce.
 */

/**
 * Counters for the job envelope's `details`. A type alias rather than an
 * interface on purpose — only aliases get the implicit index signature that
 * makes them assignable to the runner's `Record<string, string|number|boolean>`.
 */
export type SettlementSummary = {
  leagueSeasons: number;
  weeks: number;
  results: number;
  /** Picks whose game hasn't reached a terminal state, or that can't be graded. */
  unsettled: number;
  /** League seasons whose settlement threw — see the `settle-sweep.season-failed` logs. */
  failed: number;
};

const EMPTY_SUMMARY: SettlementSummary = {
  leagueSeasons: 0,
  weeks: 0,
  results: 0,
  unsettled: 0,
  failed: 0,
};

function addSummary(total: SettlementSummary, next: SettlementSummary): SettlementSummary {
  return {
    leagueSeasons: total.leagueSeasons + next.leagueSeasons,
    weeks: total.weeks + next.weeks,
    results: total.results + next.results,
    unsettled: total.unsettled + next.unsettled,
    failed: total.failed + next.failed,
  };
}

/** A league season eligible for settlement, with its settings already parsed. */
interface SettleableSeason {
  leagueSeasonId: string;
  leagueId: string;
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
      settings: leagueSeasons.settings,
      mode: leagues.mode,
    })
    .from(leagueSeasons)
    .innerJoin(leagues, eq(leagues.id, leagueSeasons.leagueId))
    .where(eq(leagueSeasons.id, leagueSeasonId));
  // Other modes settle through their own module into their own tables (ELM-4,
  // MM-6 — ADR-0016); this one grades Pick'em picks only.
  if (!row || row.mode !== LEAGUE_MODE.PICKEM) return null;

  return {
    leagueSeasonId: row.leagueSeasonId,
    leagueId: row.leagueId,
    // Parsed, never trusted — defaults must materialize before they reach
    // scoring (engineering rules §Data).
    settings: LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM].parse(row.settings),
  };
}

/**
 * Builds the pure functions' inputs for one league-week, resolving the two
 * things only this layer knows about:
 *
 * - **override precedence** (`override_* ?? provider_*`, arch D15), via the one
 *   home for it; and
 * - **week moves**. A provider week move repoints `games.week_id` while the
 *   pick keeps its own, so a game that has left this week is reported to
 *   scoring as `moved` — the spec's "treated as a cancellation". `settlePickemWeek`
 *   cannot detect this itself; it never sees a pick's week.
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
    // A game that has left this week resolves as a push here — the pick was
    // made in this week, and the spec treats a move as a cancellation, even if
    // the game went on to be played in its new week.
    //
    // The synthesized `moved` sits at the *provider* tier, below an explicit
    // `override_status`, so the coalesce stays `override_* ?? provider_*`
    // (arch D15). It has to: a week move is inferred from provider data, there
    // is no `override_week_id`, and `sync-schedule` rewrites `games.week_id` on
    // every run — so if a persistent provider error put a game in the wrong
    // week, letting the move win would make those picks permanently
    // uncorrectable by any admin action.
    const providerStatus = game.weekId === weekId ? game.status : GAME_STATUS.MOVED;
    return {
      gameId: game.id,
      status: game.overrideStatus ?? providerStatus,
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
 * Settles the named weeks of one league season and rebuilds its standings, in
 * one transaction. Standings are rebuilt once at the end rather than per week —
 * they are a whole-season derivation either way.
 */
export async function settleLeagueSeasonWeeks(
  db: Db,
  clock: Clock,
  leagueSeasonId: string,
  weekIds: readonly string[],
): Promise<SettlementSummary> {
  const season = await loadSettleableSeason(db, leagueSeasonId);
  if (!season) return EMPTY_SUMMARY;

  return db.transaction(async (tx) => {
    // Ahead of every write: the incremental, nightly, rebuild, and sim paths
    // can all settle the same season at once, and delete-then-insert without
    // this collides on the unique constraints.
    await lockLeagueSeasonRow(tx, leagueSeasonId);

    let results = 0;
    let unsettled = 0;
    for (const weekId of weekIds) {
      const settled = await settleWeekResults(tx, clock, season, weekId);
      results += settled.results;
      unsettled += settled.unsettled;
    }
    await rebuildStandings(tx, clock, season);
    return { leagueSeasons: 1, weeks: weekIds.length, results, unsettled, failed: 0 };
  });
}

/** Full recompute of one league season from scratch — the on-demand rebuild. */
export async function rebuildLeagueSeason(
  db: Db,
  clock: Clock,
  leagueSeasonId: string,
): Promise<SettlementSummary> {
  const weekIds = await weeksWithPicks(db, leagueSeasonId);
  return settleLeagueSeasonWeeks(db, clock, leagueSeasonId, weekIds);
}

/**
 * Settles every league-week holding a pick on one of the named games. Both
 * ingestion jobs call it: `sync-scores` when a game goes final, `sync-schedule`
 * when one is cancelled or moved to another week — all three change how
 * existing picks resolve.
 *
 * Scoped to the affected weeks rather than whole seasons so the 5-minute path
 * stays cheap; the nightly sweep catches anything this missed (arch D10).
 */
export async function settlePicksForGames(
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
    total = addSummary(total, await settleLeagueSeasonWeeks(db, clock, leagueSeasonId, weekIds));
  }
  return total;
}

/**
 * Nightly reconciliation (arch §Background Jobs, D10): recompute every active
 * league season from stored results, catching late stat corrections, admin
 * overrides, and any tick the incremental path missed.
 *
 * Per-season transactions rather than one global one — a single league's bad
 * data must not roll back everyone else's reconciliation, and nothing here
 * depends on cross-league atomicity.
 */
export async function settleSweep(db: Db, clock: Clock): Promise<SettlementSummary> {
  const active = await db
    .select({ id: leagueSeasons.id })
    .from(leagueSeasons)
    .where(eq(leagueSeasons.status, LEAGUE_STATUS.ACTIVE));

  let total = EMPTY_SUMMARY;
  const failures: string[] = [];

  for (const season of active) {
    try {
      total = addSummary(total, await rebuildLeagueSeason(db, clock, season.id));
    } catch (error) {
      // One league's bad data must not cost every other league its nightly
      // reconciliation. Without this catch the first throw ends the sweep and
      // every season after it — in unspecified order — goes unreconciled, every
      // night, until someone finds the bad row. The league id is the thing an
      // operator needs and the thrown message never carries it.
      failures.push(season.id);
      total = addSummary(total, { ...EMPTY_SUMMARY, failed: 1 });
      logError("settle-sweep.season-failed", { leagueSeasonId: season.id, error });
    }
  }

  // Non-2xx only after every season has been attempted: the job must still
  // alert (ADR-0007 — cron-job.org emails on a failed request), but alerting
  // by aborting would be the bug this catch exists to prevent.
  if (failures.length > 0) {
    throw new Error(
      `settle-sweep: ${failures.length} of ${active.length} league seasons failed to settle (${failures.join(", ")})`,
    );
  }

  return total;
}
