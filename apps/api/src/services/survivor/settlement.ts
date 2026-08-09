import { count, eq, inArray, max, or } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  adminAudit,
  games,
  leagueMembers,
  leagueSeasons,
  leagues,
  survivorPickResults,
  survivorPicks,
  survivorState,
  weeks,
} from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  ADMIN_AUDIT_ACTION,
  ADMIN_AUDIT_TARGET_TABLE,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  nflSeasonOrdinal,
  toNflWeekRef,
  type SurvivorSettings,
} from "@picksleagues/schemas";
import {
  settleSurvivorWeek,
  settleSurvivorWeekProvisionally,
  SURVIVOR_TRANSITION,
  SURVIVOR_UNSETTLED_REASON,
  type SurvivorGameResult,
} from "@picksleagues/scoring";
import { resolveGameOverrides } from "../games";
import { applyLeagueSeasonConclusion } from "../leagues/conclusion";
import { lockLeagueSeasonRow } from "../leagues/locks";
import { logInfo } from "../../lib/logger";
import { addSummary, EMPTY_SUMMARY, type SettlementSummary } from "../settlement";
import { isSurvivorRangeWeek } from "./season";

/**
 * Survivor settlement orchestration (arch D10, §Settlement & Scoring; ADR-0025).
 * Reached through the mode dispatch in `services/settlement.ts`.
 *
 * **The whole module is one shape: replay the league season's weeks in order.**
 * A Survivor week cannot be settled on its own — missed-pick elimination and
 * the everyone-out revival are totals over the alive-set the *previous* week
 * produced — so a week settles only when every game in it is terminal and every
 * in-range prior week has already settled (ADR-0025). `settleSurvivorWeek`
 * enforces the first of those and can only enforce the first; the prefix is
 * this module's obligation.
 *
 * There is no "settle just this week" entry point for the same reason, and no
 * incremental path either: a replay always starts from the season's first
 * in-range week. That is deliberate rather than lazy. `survivor_state`
 * accumulates `revived_count` across the whole season with no per-week marker
 * to resume from, so a replay starting mid-season would either double-count a
 * revival it re-derived or drop one it skipped — and the settleable prefix is
 * derived from game statuses rather than stored, so the full replay is the same
 * computation the nightly sweep does anyway, over at most one season of weeks.
 *
 * Every write is delete-then-insert rather than diffed, which is what makes it
 * idempotent: settling twice, or rebuilding, lands on identical state.
 */

/** A Survivor league season eligible for settlement, with its settings parsed. */
interface SettleableSurvivorSeason {
  leagueSeasonId: string;
  leagueId: string;
  seasonId: string;
  settings: SurvivorSettings;
}

/** A week of the bound season and its position in it — which is the replay order. */
interface SeasonWeek {
  id: string;
  ordinal: number;
  inRange: boolean;
}

async function loadSettleableSeason(
  db: Db,
  leagueSeasonId: string,
): Promise<SettleableSurvivorSeason | null> {
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
  // Re-checked here rather than trusted from the dispatcher, so a direct caller
  // can't grade the wrong mode into Survivor's tables (ADR-0016).
  if (!row || row.mode !== LEAGUE_MODE.SURVIVOR) return null;

  return {
    leagueSeasonId: row.leagueSeasonId,
    leagueId: row.leagueId,
    seasonId: row.seasonId,
    // Parsed, never trusted — defaults must materialize before they reach
    // scoring (engineering rules §Data).
    settings: LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.SURVIVOR].parse(row.settings),
  };
}

/**
 * The season's weeks in replay order, each flagged for whether the league plays
 * it. Ordered by season ordinal rather than by `starts_at`, because the ordinal
 * *is* the prefix ADR-0025 orders on and two weeks can share a start instant.
 * Survivor is regular-season only (spec §Game Mode 2 — Core Rules), so a
 * postseason week is never in range whatever the stored settings say.
 */
async function loadSeasonWeeks(db: Db, season: SettleableSurvivorSeason): Promise<SeasonWeek[]> {
  const rows = await db
    .select({ id: weeks.id, weekType: weeks.weekType, weekNumber: weeks.weekNumber })
    .from(weeks)
    .where(eq(weeks.seasonId, season.seasonId));

  return rows
    .map((row) => ({
      id: row.id,
      // Every week gets an ordinal, in range or not: the replay order is the
      // whole season's, and a postseason week still has to sort after the
      // regular ones it follows.
      ordinal: nflSeasonOrdinal(toNflWeekRef(row)),
      inRange: isSurvivorRangeWeek(row, season.settings),
    }))
    .sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * Resolves the one thing only this layer knows about: **override precedence**
 * (`override_* ?? provider_*`, arch D15), via the one home for it. Both team ids
 * come straight off the row — a Survivor pick names a team rather than a side,
 * and there is no override for who played.
 */
function toGameResult(game: typeof games.$inferSelect): SurvivorGameResult {
  const effective = resolveGameOverrides(game);
  return {
    gameId: game.id,
    status: effective.status,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    homeScore: effective.homeScore,
    awayScore: effective.awayScore,
  };
}

/**
 * What one replay decided, before any of it is written. Held in memory across
 * the whole season rather than flushed per week because the `released` ledger
 * is a whole-season answer: its sticky rule looks forward from a week to every
 * later pick of the same team.
 */
interface SeasonReplay {
  resultRows: Array<typeof survivorPickResults.$inferInsert>;
  /** Pick id → whether the graded week spent the member's team. */
  consumedByPickId: Map<string, boolean>;
  eliminatedWeekByMember: Map<string, string>;
  revivedCountByMember: Map<string, number>;
  weeks: number;
  unsettled: number;
  /**
   * Whether the replay ended the season — Survivor's arm of the conclusion rule
   * (ADR-0030), which is the replay's own answer rather than a second reading of
   * the game rows. Both of ADR-0027's endings are exactly where this loop stops.
   */
  decided: boolean;
}

/**
 * Replays every settleable week of one league season, stopping at the first
 * week that isn't complete — the prefix invariant (ADR-0025), which is why that
 * `break` is load-bearing rather than an early exit for tidiness. A later week
 * settling against a stale alive-set doesn't produce a stale number, it ends
 * the wrong member's season.
 *
 * It stops again on the week that decides the season (ADR-0027), for the reason
 * given where that `break` sits.
 *
 * The week it stops *on* is not necessarily blank: a week that has graded one
 * member safe has already put out every member whose own pick lost, and that
 * elimination is written before the stop (ADR-0028).
 */
function replaySeason(
  season: SettleableSurvivorSeason,
  seasonWeeks: readonly SeasonWeek[],
  memberIds: readonly string[],
  picksByWeek: ReadonlyMap<string, Array<typeof survivorPicks.$inferSelect>>,
  gamesForWeek: (weekId: string) => SurvivorGameResult[],
  settledAt: Date,
): SeasonReplay {
  const replay: SeasonReplay = {
    resultRows: [],
    consumedByPickId: new Map(),
    eliminatedWeekByMember: new Map(),
    revivedCountByMember: new Map(),
    weeks: 0,
    unsettled: 0,
    decided: false,
  };

  let alive: readonly string[] = memberIds;
  const inRangeWeeks = seasonWeeks.filter((week) => week.inRange);

  for (const week of inRangeWeeks) {
    const picks = picksByWeek.get(week.id) ?? [];
    const results = gamesForWeek(week.id);
    // A week with no games is not a complete week, it is a week the schedule
    // has not filled. Grading it would eliminate every member for missing a
    // pick in a week they were never offered, so it blocks the prefix exactly
    // as a postponed game does.
    if (results.length === 0) break;

    const pickInputs = picks.map((pick) => ({
      pickId: pick.id,
      memberId: pick.leagueMemberId,
      gameId: pick.gameId,
      teamId: pick.teamId,
    }));

    const settlement = settleSurvivorWeek(alive, pickInputs, results, season.settings);

    if (settlement.unsettled.length > 0) {
      // **A week that cannot be graded as a unit may still be over for some of
      // its members** (ADR-0028): once one member who entered it alive is
      // confirmed safe, revival cannot fire, and every member whose own pick has
      // already lost is out for good. Only `survivor_state` is written — no
      // result rows and so no `teamConsumed`, because the `released` ledger
      // below is a whole-season answer that partial consumption data would
      // corrupt.
      //
      // The stop below still happens. The alive set this leaves is not final —
      // the week's ungraded picks have yet to say anything — so week N+1 must
      // not be graded against it (ADR-0025).
      const provisional = settleSurvivorWeekProvisionally(
        alive,
        pickInputs,
        results,
        season.settings,
      );
      for (const memberId of provisional.eliminatedMemberIds) {
        replay.eliminatedWeekByMember.set(memberId, week.id);
      }

      // **`decided` stays false here even when this week has already settled
      // the result** (ADR-0030). A provisional pass can leave one member
      // standing, and the board does say so — but it derives that from
      // `survivor_state` in this module's `season.ts` sibling rather than from
      // this flag, precisely because the two questions come apart at this line.
      // "Who won" is answerable now; "is there anything left to grade" is not,
      // because this week is by definition ungradeable and has written no result
      // rows. Retiring the season on the first answer strands the second: a
      // concluded season leaves the nightly sweep, and the games still open here
      // hold no pick by anyone left alive, so the incremental path — which finds
      // a season only through a pick on the changed game — would never bring it
      // back when they go final. The week would stay ungraded forever.

      for (const game of settlement.unsettled) {
        // A final game with no score is a provider fault an admin override
        // fixes — worth a log line, unlike the ordinary not-yet-played case.
        if (game.reason !== SURVIVOR_UNSETTLED_REASON.NOT_YET_PLAYED) {
          logInfo("settlement.unsettleable-game", {
            leagueSeasonId: season.leagueSeasonId,
            weekId: week.id,
            gameId: game.gameId,
            reason: game.reason,
          });
        }
      }
      replay.unsettled += settlement.unsettled.length;
      break;
    }

    replay.weeks += 1;
    for (const outcome of settlement.outcomes) {
      replay.resultRows.push({
        survivorPickId: outcome.pickId,
        leagueSeasonId: season.leagueSeasonId,
        leagueMemberId: outcome.memberId,
        weekId: week.id,
        outcome: outcome.outcome,
        settledAt,
      });
      replay.consumedByPickId.set(outcome.pickId, outcome.teamConsumed);
    }
    for (const transition of settlement.transitions) {
      if (transition.transition === SURVIVOR_TRANSITION.ELIMINATED) {
        replay.eliminatedWeekByMember.set(transition.memberId, week.id);
      } else if (transition.transition === SURVIVOR_TRANSITION.REVIVED) {
        replay.revivedCountByMember.set(
          transition.memberId,
          (replay.revivedCountByMember.get(transition.memberId) ?? 0) + 1,
        );
      }
    }

    alive = settlement.aliveMemberIds;

    // **A season the settlement just decided is graded no further** (ADR-0027).
    // From the week that reduces the league to a sole survivor, the pick
    // endpoint refuses every member — the winner included — so no later week
    // holds a pick of theirs however completely it plays out. Grading on would
    // read each of those weeks as a missed pick and so bust the sole survivor,
    // who is by then the whole alive set: revival hands their life straight
    // back, every remaining week, without bound.
    //
    // Reduction is the test rather than the bare count: a member alone in a
    // league nobody joined has won nothing and is still owed every week of it
    // (ADR-0027).
    if (alive.length === 1 && memberIds.length > 1) {
      replay.decided = true;
      break;
    }
  }

  // The other ending (ADR-0027): every week the league plays has been graded, so
  // the loop above ran to exhaustion rather than breaking. `weeks` counts graded
  // weeks and every iteration either grades or breaks, so the equality *is* "it
  // never broke" — which is what makes this the replay's answer and not a second
  // walk of the game rows. A season with no in-range week has an un-ingested
  // schedule, not an instantly-finished range.
  if (!replay.decided && inRangeWeeks.length > 0 && replay.weeks === inRangeWeeks.length) {
    replay.decided = true;
  }

  return replay;
}

/**
 * The `released` flag every pick ends the replay with (ADR-0025 decision 1): a
 * team returns to the member's ledger only when the game it was spent on was
 * cancelled. A pick settlement didn't grade — an eliminated member's, or one in
 * a week the prefix hasn't reached — holds its team, which is the state the
 * pick endpoint wrote.
 *
 * **Release is sticky once relied upon** (ADR-0025 decision 2), which is what
 * the second pass implements: of the picks a member holds on one team, only the
 * last may be unreleased. Without it, reverting a cancellation after the member
 * legally re-picked the returned team would recreate two live ledger rows,
 * collide with `survivor_picks_member_team_unique`, and leave the league season
 * *permanently unsettleable* — settlement aborting with no remedy short of a
 * database edit. With it, settlement always completes and the team having been
 * used twice is the audited consequence of the operator's flip-flop.
 */
function resolveReleasedFlags(
  picks: ReadonlyArray<typeof survivorPicks.$inferSelect>,
  consumedByPickId: ReadonlyMap<string, boolean>,
  weekOrdinals: ReadonlyMap<string, number>,
): Map<string, boolean> {
  const released = new Map<string, boolean>(
    picks.map((pick) => [pick.id, consumedByPickId.get(pick.id) === false]),
  );

  const byMemberTeam = new Map<string, Array<typeof survivorPicks.$inferSelect>>();
  for (const pick of picks) {
    if (released.get(pick.id)) continue;
    const key = `${pick.leagueMemberId}:${pick.teamId}`;
    const bucket = byMemberTeam.get(key);
    if (bucket) bucket.push(pick);
    else byMemberTeam.set(key, [pick]);
  }

  for (const bucket of byMemberTeam.values()) {
    if (bucket.length < 2) continue;
    bucket.sort((a, b) => (weekOrdinals.get(a.weekId) ?? 0) - (weekOrdinals.get(b.weekId) ?? 0));
    for (const pick of bucket.slice(0, -1)) released.set(pick.id, true);
  }

  return released;
}

/**
 * Records an admin's rebuild against the league season whose derived state it
 * is about to replace (engineering rules §Data: "every override/rebuild writes
 * `admin_audit`"), in the same transaction as the recompute it records.
 *
 * The prior value is a summary rather than the rows, for the reason the Pick'em
 * path records one: the rows are a derivation arch D10 already defines as
 * reproducible, while what the trail must answer — what stood here, and when it
 * last settled — is exactly what counts plus last-write instants answer, at
 * constant size. The counts are Survivor's own tables; a per-mode recompute
 * that reported another mode's would be recording something it never touched.
 */
async function recordRebuildAudit(
  tx: Db,
  clock: Clock,
  leagueSeasonId: string,
  adminUserId: string,
): Promise<void> {
  const [results] = await tx
    .select({ rows: count(), lastSettledAt: max(survivorPickResults.settledAt) })
    .from(survivorPickResults)
    .where(eq(survivorPickResults.leagueSeasonId, leagueSeasonId));
  const [state] = await tx
    .select({ rows: count(), lastUpdatedAt: max(survivorState.updatedAt) })
    .from(survivorState)
    .where(eq(survivorState.leagueSeasonId, leagueSeasonId));

  await tx.insert(adminAudit).values({
    adminUserId,
    action: ADMIN_AUDIT_ACTION.LEAGUE_REBUILD,
    targetTable: ADMIN_AUDIT_TARGET_TABLE.LEAGUE_SEASONS,
    targetId: leagueSeasonId,
    priorValue: {
      resultCount: results?.rows ?? 0,
      stateRowCount: state?.rows ?? 0,
      lastSettledAt: results?.lastSettledAt?.toISOString() ?? null,
      lastStateUpdatedAt: state?.lastUpdatedAt?.toISOString() ?? null,
    },
    createdAt: clock.now(),
  });
}

/**
 * Replays one Survivor league season and persists everything it derived —
 * `survivor_pick_results`, `survivor_state`, and the `survivor_picks.released`
 * ledger — in one transaction. Pass `audit` when a named admin asked for it, so
 * the recompute and its `admin_audit` row commit or roll back together.
 *
 * This is both the incremental path and the rebuild: see the module header for
 * why Survivor has only the one.
 */
export async function rebuildSurvivorLeagueSeason(
  db: Db,
  clock: Clock,
  leagueSeasonId: string,
  audit?: { adminUserId: string },
): Promise<SettlementSummary> {
  const season = await loadSettleableSeason(db, leagueSeasonId);
  // Nothing here is settleable, so nothing is wiped and there is no prior value
  // to record honestly — an audited no-op would claim a recompute that never ran.
  if (!season) return EMPTY_SUMMARY;

  const seasonWeeks = await loadSeasonWeeks(db, season);

  return db.transaction(async (tx) => {
    // Ahead of every write: the incremental, nightly, rebuild, and sim paths
    // can all settle the same season at once, and delete-then-insert without
    // this collides on the unique constraints.
    await lockLeagueSeasonRow(tx, leagueSeasonId);

    // Under the lock and before the first delete, so the recorded prior state is
    // the one this transaction replaces and no concurrent settle can shift it.
    if (audit) await recordRebuildAudit(tx, clock, leagueSeasonId, audit.adminUserId);

    const members = await tx
      .select({ id: leagueMembers.id })
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, season.leagueId));
    // Sorted so a replay's outcome and transition order depends on the league,
    // not on the order Postgres happened to return rows in.
    const memberIds = members.map((member) => member.id).sort();

    const picks = await tx
      .select()
      .from(survivorPicks)
      .where(eq(survivorPicks.leagueSeasonId, leagueSeasonId));

    const picksByWeek = new Map<string, Array<typeof survivorPicks.$inferSelect>>();
    for (const pick of picks) {
      const bucket = picksByWeek.get(pick.weekId);
      if (bucket) bucket.push(pick);
      else picksByWeek.set(pick.weekId, [pick]);
    }

    const gamesForWeek = await loadSeasonGames(tx, seasonWeeks, picks);

    const replay = replaySeason(
      season,
      seasonWeeks,
      memberIds,
      picksByWeek,
      gamesForWeek,
      clock.now(),
    );

    await writeReplay(tx, clock, season, memberIds, picks, seasonWeeks, replay);

    // In the same transaction as the state it describes (ADR-0030), so a
    // rolled-back replay can't leave a season marked finished on rows that were
    // never written — and so the board, which now reads this status rather than
    // re-deriving the ending, can never see one without the other.
    await applyLeagueSeasonConclusion(tx, clock, leagueSeasonId, replay.decided);

    return {
      leagueSeasons: 1,
      weeks: replay.weeks,
      results: replay.resultRows.length,
      unsettled: replay.unsettled,
      failed: 0,
    };
  });
}

/**
 * Every game the replay can need, keyed by the week it settles under. A pick's
 * own game is included even when it now sits in another week: week moves are
 * out of scope (ADR-0019) and the remedy is an admin `cancelled` override, but
 * a repointed row must still reach the grader rather than throw.
 */
async function loadSeasonGames(
  tx: Db,
  seasonWeeks: readonly SeasonWeek[],
  picks: ReadonlyArray<typeof survivorPicks.$inferSelect>,
): Promise<(weekId: string) => SurvivorGameResult[]> {
  const weekIds = seasonWeeks.filter((week) => week.inRange).map((week) => week.id);
  const pickGameIds = [...new Set(picks.map((pick) => pick.gameId))];
  if (weekIds.length === 0) return () => [];

  const rows = await tx
    .select()
    .from(games)
    .where(
      pickGameIds.length > 0
        ? or(inArray(games.weekId, weekIds), inArray(games.id, pickGameIds))
        : inArray(games.weekId, weekIds),
    );

  const byId = new Map(rows.map((row) => [row.id, row]));
  const byWeek = new Map<string, Map<string, SurvivorGameResult>>(
    weekIds.map((weekId) => [weekId, new Map()]),
  );
  for (const row of rows) {
    byWeek.get(row.weekId)?.set(row.id, toGameResult(row));
  }
  for (const pick of picks) {
    const game = byId.get(pick.gameId);
    if (game) byWeek.get(pick.weekId)?.set(game.id, toGameResult(game));
  }

  return (weekId) => [...(byWeek.get(weekId)?.values() ?? [])];
}

/** Persists a replay wholesale — delete-then-insert, never diffed (arch D10). */
async function writeReplay(
  tx: Db,
  clock: Clock,
  season: SettleableSurvivorSeason,
  memberIds: readonly string[],
  picks: ReadonlyArray<typeof survivorPicks.$inferSelect>,
  seasonWeeks: readonly SeasonWeek[],
  replay: SeasonReplay,
): Promise<void> {
  await tx
    .delete(survivorPickResults)
    .where(eq(survivorPickResults.leagueSeasonId, season.leagueSeasonId));
  if (replay.resultRows.length > 0) {
    await tx.insert(survivorPickResults).values(replay.resultRows);
  }

  const updatedAt = clock.now();
  const stateRows = memberIds.flatMap((memberId) => {
    const eliminatedWeekId = replay.eliminatedWeekByMember.get(memberId) ?? null;
    const revivedCount = replay.revivedCountByMember.get(memberId) ?? 0;
    // Absence of a row means alive and untouched (ADR-0025), so a member the
    // season has decided nothing about gets none — that is what keeps the rule
    // true after the first settle as well as before it.
    if (eliminatedWeekId === null && revivedCount === 0) return [];
    return [
      {
        leagueSeasonId: season.leagueSeasonId,
        leagueMemberId: memberId,
        // One life per member in the MVP (spec §Game Mode 2 — Core Rules), so
        // this is not independent state: it mirrors the elimination the week ref
        // records, rather than leaving an eliminated member's row reading as
        // though they still held a life.
        livesRemaining: eliminatedWeekId === null ? 1 : 0,
        eliminatedWeekId,
        revivedCount,
        updatedAt,
      },
    ];
  });

  await tx.delete(survivorState).where(eq(survivorState.leagueSeasonId, season.leagueSeasonId));
  if (stateRows.length > 0) await tx.insert(survivorState).values(stateRows);

  const weekOrdinals = new Map(seasonWeeks.map((week) => [week.id, week.ordinal]));
  const released = resolveReleasedFlags(picks, replay.consumedByPickId, weekOrdinals);
  const toRelease = picks.filter((pick) => released.get(pick.id) === true);
  const toHold = picks.filter((pick) => released.get(pick.id) !== true);

  // Releases first: `survivor_picks_member_team_unique` is a live partial index,
  // so claiming a team's slot before the row that held it has let go would abort
  // the transaction on a state the replay never intended to leave behind.
  //
  // `updated_at` is deliberately untouched — it records the member's last change
  // to their own pick, and bumping it on every idempotent re-settle would both
  // lie about that and stop a re-run landing on identical state.
  if (toRelease.length > 0) {
    await tx
      .update(survivorPicks)
      .set({ released: true })
      .where(
        inArray(
          survivorPicks.id,
          toRelease.map((pick) => pick.id),
        ),
      );
  }
  if (toHold.length > 0) {
    await tx
      .update(survivorPicks)
      .set({ released: false })
      .where(
        inArray(
          survivorPicks.id,
          toHold.map((pick) => pick.id),
        ),
      );
  }
}

/**
 * Replays every Survivor league season holding a pick on one of the named
 * games. Both ingestion jobs reach it: `sync-scores` when a game goes final,
 * `sync-schedule` when one is cancelled.
 *
 * Scoped to the season rather than the affected week, because a correction to
 * an already-settled week invalidates every downstream alive/eliminated/revived
 * state — leaving that to the nightly sweep would show wrong, member-visible
 * survivor state for up to a day (ADR-0025).
 */
export async function settleSurvivorPicksForGames(
  db: Db,
  clock: Clock,
  gameIds: readonly string[],
): Promise<SettlementSummary> {
  if (gameIds.length === 0) return EMPTY_SUMMARY;

  const affected = await db
    .selectDistinct({ leagueSeasonId: survivorPicks.leagueSeasonId })
    .from(survivorPicks)
    .where(inArray(survivorPicks.gameId, [...gameIds]));

  let total = EMPTY_SUMMARY;
  for (const row of affected) {
    total = addSummary(total, await rebuildSurvivorLeagueSeason(db, clock, row.leagueSeasonId));
  }
  return total;
}
