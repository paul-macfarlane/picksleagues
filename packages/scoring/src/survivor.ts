import {
  GAME_STATUS,
  isUnplayedStatus,
  PICK_OUTCOME,
  type GameStatus,
  type PickOutcome,
} from "@picksleagues/schemas";
import { pickOutcomeForMargin } from "./pick-outcome";

/**
 * Survivor settlement (spec §Game Mode 2).
 *
 * Pure by rule, like every module here: plain data in, plain data out, no clock
 * and no I/O. Override precedence (`override_* ?? provider_*`, arch D15) is
 * resolved by the caller's input loader, so this module never sees a provider
 * field.
 *
 * **A Survivor week grades as a unit, where a Pick'em week grades pick by
 * pick**, and that difference is what shapes everything below. Missed-pick
 * elimination and the everyone-out revival are week *totals* — they are
 * answers about the whole slate, not about one pick — so a week holding any
 * game that is still ahead of us grades to nothing at all rather than to a
 * partial result a later run would have to revise. ADR-0025 turns the same
 * fact into its caller-side obligation: weeks settle prefix-ordered, each
 * against the alive-set the previous one produced, which is why the entering
 * alive-set is an argument here and the surviving one is a return value.
 *
 * The one thing a partly played week *can* decide is who it has already put out
 * for good, which `settleSurvivorWeekProvisionally` answers under the narrow
 * condition that makes revival impossible (ADR-0028). It is a second function
 * rather than a mode of the first: every settled season rests on the complete
 * grade, and a rule about incomplete weeks does not belong inside it.
 *
 * Survivor is straight-up only (ADR-0026), so nothing here consults a spread,
 * and a tied final score always advances with the team consumed — the
 * Push/Tie Resolution setting was cut at its default (ADR-0033), so no
 * settings reach this package at all. The margin *arithmetic* stays this
 * module's own (one subtraction, `pickedTeamMargin` — sharing it with
 * `pickem.ts`'s spread math would cost more indirection than it saves), but
 * the margin-to-verdict mapping is `pick-outcome.ts`'s, shared with Pick'em's
 * settlement and both modes' client-side derived badges (FB-23, PKM-11):
 * once four call sites state the same mapping, a shared function is what
 * keeps spec §Settled pick margin's no-contradiction promise structural.
 */

/** A member's single pick for the week, as stored on `survivor_picks`. */
export interface SurvivorPickInput {
  pickId: string;
  memberId: string;
  gameId: string;
  /** The team being ridden — one of the game's two sides. */
  teamId: string;
}

/**
 * A game's settled truth, with overrides already resolved by the caller. Both
 * team IDs are carried because a Survivor pick names a *team*, not a side, so
 * there is no way to tell which end of the score belongs to it otherwise.
 */
export interface SurvivorGameResult {
  gameId: string;
  status: GameStatus;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
}

/**
 * What the week did to a member who entered it alive. Scoped to this package
 * rather than `packages/schemas`: it is settlement's own report to its caller,
 * and the member state the board renders comes from `survivor_state`, which
 * records an eliminating week rather than a transition.
 */
export const SURVIVOR_TRANSITION = {
  ADVANCED: "advanced",
  ELIMINATED: "eliminated",
  REVIVED: "revived",
} as const;

export type SurvivorTransition = (typeof SURVIVOR_TRANSITION)[keyof typeof SURVIVOR_TRANSITION];

export interface SurvivorMemberTransition {
  memberId: string;
  transition: SurvivorTransition;
}

export interface SurvivorPickOutcome {
  pickId: string;
  memberId: string;
  gameId: string;
  outcome: PickOutcome;
  /**
   * Whether the team leaves the member's ledger for the rest of the season.
   * Every played game consumes it — correct, incorrect, and tie alike — and
   * only a cancellation hands it back (spec §Game Mode 2 — Team reuse,
   * Cancelled game). Written through to `survivor_picks.released` by the
   * caller, which is the one writer of that flag (ADR-0025).
   */
  teamConsumed: boolean;
}

/**
 * Why the week could not be graded. `not_yet_played` is the ordinary case — a
 * game in the week has not reached a terminal state. `final_without_scores` is
 * a provider data fault on a game somebody picked: it claims to be over but
 * carries no score, so it is surfaced rather than graded against a missing
 * number, and an admin score override corrects it (arch §Overrides).
 */
export const SURVIVOR_UNSETTLED_REASON = {
  NOT_YET_PLAYED: "not_yet_played",
  FINAL_WITHOUT_SCORES: "final_without_scores",
} as const;

export type SurvivorUnsettledReason =
  (typeof SURVIVOR_UNSETTLED_REASON)[keyof typeof SURVIVOR_UNSETTLED_REASON];

/**
 * Reported per *game* rather than per pick, unlike Pick'em's: a game nobody
 * picked still holds the week open, because a member with no pick yet can
 * legally still make one, and eliminating them for a missed pick before that
 * game kicks off would end their season a week early.
 */
export interface SurvivorUnsettledGame {
  gameId: string;
  reason: SurvivorUnsettledReason;
}

export interface SurvivorWeekSettlement {
  outcomes: SurvivorPickOutcome[];
  transitions: SurvivorMemberTransition[];
  /**
   * Who is alive after the week — the argument the *next* week's settlement
   * takes. Returned rather than left for the caller to derive from
   * `transitions`, because threading this set week to week is the whole of
   * ADR-0025's prefix ordering and re-deriving it at each caller is where that
   * would quietly go wrong. Unchanged from the entering set when the week is
   * unsettled.
   */
  aliveMemberIds: string[];
  unsettled: SurvivorUnsettledGame[];
}

/**
 * Settles one league-week of a Survivor season.
 *
 * `aliveMemberIds` is the set entering the week, which the caller derives from
 * `survivor_state` where a *missing* row means alive (ADR-0025 — absence means
 * alive, so readers left-join). Lives are not modelled: every member has
 * exactly one in the MVP (spec §Game Mode 2 — Core Rules), and a life counter
 * this function cannot yet be given a losing case for would be untested
 * arithmetic standing between the rules and the ledger.
 *
 * A pick by a member outside that set grades to nothing — no outcome, no
 * transition, no team consumed. That is the settled counterpart of the rule
 * letting an about-to-be-eliminated member keep picking until their week
 * settles (ADR-0025): the pick was legal when it was made, and if the revival
 * rule brings them back it was also load-bearing.
 *
 * @throws if a pick references a game absent from `results`, if a graded pick
 * names a team that is not in its game, or if one member holds two picks for
 * the week. All three are loader or write-path bugs — the week's results are
 * loaded from the week's games, the pick endpoint writes a side of the picked
 * game, and `survivor_picks_member_week_unique` makes the third impossible in
 * the database — so they are surfaced rather than silently graded around.
 */
export function settleSurvivorWeek(
  aliveMemberIds: readonly string[],
  picks: readonly SurvivorPickInput[],
  results: readonly SurvivorGameResult[],
): SurvivorWeekSettlement {
  const resultsByGameId = indexResults(COMPLETE, picks, results);
  const aliveEntering = new Set(aliveMemberIds);
  const pickByMemberId = indexPicksByMember(COMPLETE, picks);

  const unsettled = blockingGames(picks, results, resultsByGameId, aliveEntering);
  if (unsettled.length > 0) {
    return { outcomes: [], transitions: [], aliveMemberIds: [...aliveMemberIds], unsettled };
  }

  const outcomes: SurvivorPickOutcome[] = [];
  const eliminated = new Set<string>();

  for (const memberId of aliveMemberIds) {
    const pick = pickByMemberId.get(memberId);
    // Missed pick: eliminated, with no outcome row to write and no team spent
    // (spec §Game Mode 2 — Missed pick).
    if (!pick) {
      eliminated.add(memberId);
      continue;
    }

    const graded = gradePick(COMPLETE, pick, resultsByGameId.get(pick.gameId)!);
    outcomes.push(graded.outcome);
    if (graded.eliminates) {
      eliminated.add(memberId);
    }
  }

  // Everyone who entered the week alive left it eliminated, so they all come
  // back (spec §Game Mode 2 — Everyone eliminated in the same week). Only the
  // life is restored: teams the busting picks spent stay spent, which is why
  // `outcomes` is untouched here.
  const revived = aliveMemberIds.length > 0 && eliminated.size === aliveMemberIds.length;

  const transitions = aliveMemberIds.map((memberId) => ({
    memberId,
    transition: eliminated.has(memberId)
      ? revived
        ? SURVIVOR_TRANSITION.REVIVED
        : SURVIVOR_TRANSITION.ELIMINATED
      : SURVIVOR_TRANSITION.ADVANCED,
  }));

  return {
    outcomes,
    transitions,
    aliveMemberIds: revived
      ? [...aliveMemberIds]
      : aliveMemberIds.filter((memberId) => !eliminated.has(memberId)),
    unsettled,
  };
}

/**
 * What a **partly graded** week has already decided for good — nothing else, and
 * usually nothing at all.
 */
export interface SurvivorProvisionalSettlement {
  /**
   * Members who entered the week alive and have now left it eliminated, whatever
   * the week's remaining games do. Empty whenever the safety rule below is not
   * met, which is the ordinary mid-week case rather than a failure.
   */
  eliminatedMemberIds: string[];
}

/**
 * Decides who a week has already put out while it is still being played
 * (ADR-0028).
 *
 * **A member goes out early only while some member who entered the week alive
 * holds a graded pick that does not eliminate them** — a win, a cancellation, or
 * a tie (which always advances, ADR-0033). That *confirmed survivor* is the exact negation
 * of the everyone-out revival (spec §Game Mode 2 — Everyone eliminated in the
 * same week): with one member certain to come through, revival cannot fire this
 * week however the open games land, so a graded losing pick is a final answer
 * rather than one a revival might reverse.
 *
 * The same condition is what keeps ADR-0025's pick-in-the-gap rule intact. That
 * rule lets a busted member keep picking until their elimination settles
 * *because* revival might bring them back; eliminating them here would refuse
 * them that pick, and the confirmed-survivor test is the guarantee they will
 * never need it.
 *
 * **A member with no pick is never returned.** Every unstarted game in the week
 * is still theirs to take, so a missed pick stays what the spec calls it —
 * resolved after the week completes (§Game Mode 2 — Missed pick).
 *
 * Deliberately no outcomes and no `teamConsumed`: the caller writes
 * `survivor_state` from this and nothing else, because the `released` ledger is
 * a whole-season answer that partial consumption data would silently corrupt
 * (ADR-0028 decision 2).
 *
 * Separate from `settleSurvivorWeek` rather than a mode of it, and it never
 * grades a member that function would not: the complete week's eliminations are
 * always a superset of these.
 *
 * @throws on the same loader and write-path bugs `settleSurvivorWeek` surfaces.
 */
export function settleSurvivorWeekProvisionally(
  aliveMemberIds: readonly string[],
  picks: readonly SurvivorPickInput[],
  results: readonly SurvivorGameResult[],
): SurvivorProvisionalSettlement {
  const resultsByGameId = indexResults(PROVISIONAL, picks, results);
  const pickByMemberId = indexPicksByMember(PROVISIONAL, picks);

  const eliminatedMemberIds: string[] = [];
  let confirmedSurvivor = false;

  for (const memberId of aliveMemberIds) {
    const pick = pickByMemberId.get(memberId);
    if (!pick) continue;

    // Non-null because `indexResults` rejects a pick with no matching result.
    const result = resultsByGameId.get(pick.gameId)!;
    if (!isGradableAlone(result)) continue;

    if (gradePick(PROVISIONAL, pick, result).eliminates) {
      eliminatedMemberIds.push(memberId);
    } else {
      confirmedSurvivor = true;
    }
  }

  return { eliminatedMemberIds: confirmedSurvivor ? eliminatedMemberIds : [] };
}

// Whether one pick can be graded without waiting for the rest of the week: the
// game is terminal, and a played one carries the scores to grade against.
//
// `blockingGames` below states the same test from the other end — which games
// hold the whole week open — and the two must not drift: a game this call
// accepts while that one blocks on it would grade a member early against a
// result the complete week refuses to grade at all.
function isGradableAlone(result: SurvivorGameResult): boolean {
  if (isUnplayedStatus(result.status)) return true;
  return (
    result.status === GAME_STATUS.FINAL && result.homeScore !== null && result.awayScore !== null
  );
}

// Both entry points reject the same two caller bugs and name themselves in the
// message, so a thrown error points at the pass that hit it.
const COMPLETE = "settleSurvivorWeek";
const PROVISIONAL = "settleSurvivorWeekProvisionally";

function indexResults(
  caller: string,
  picks: readonly SurvivorPickInput[],
  results: readonly SurvivorGameResult[],
): Map<string, SurvivorGameResult> {
  const resultsByGameId = new Map(results.map((result) => [result.gameId, result]));
  for (const pick of picks) {
    if (!resultsByGameId.has(pick.gameId)) {
      throw new Error(
        `${caller}: pick ${pick.pickId} references game ${pick.gameId}, which is absent from the supplied results`,
      );
    }
  }
  return resultsByGameId;
}

// Keyed over every pick, not only the live ones: the database constraint this
// backstops holds for eliminated members too, so a second row there is the same
// write-path bug and is worth the same noise. Entries for members who are
// already out are simply never read.
function indexPicksByMember(
  caller: string,
  picks: readonly SurvivorPickInput[],
): Map<string, SurvivorPickInput> {
  const pickByMemberId = new Map<string, SurvivorPickInput>();
  for (const pick of picks) {
    if (pickByMemberId.has(pick.memberId)) {
      throw new Error(`${caller}: member ${pick.memberId} holds more than one pick for this week`);
    }
    pickByMemberId.set(pick.memberId, pick);
  }
  return pickByMemberId;
}

// The week is settleable only once every game in it is terminal — final or
// cancelled (ADR-0025 precondition (a)) — and every game a live pick depends on
// carries the scores needed to grade it. A game nobody live picked may be a data
// fault without holding the week: it decides nothing.
function blockingGames(
  picks: readonly SurvivorPickInput[],
  results: readonly SurvivorGameResult[],
  resultsByGameId: ReadonlyMap<string, SurvivorGameResult>,
  aliveEntering: ReadonlySet<string>,
): SurvivorUnsettledGame[] {
  const blocking = new Map<string, SurvivorUnsettledReason>();

  for (const result of results) {
    if (result.status !== GAME_STATUS.FINAL && !isUnplayedStatus(result.status)) {
      blocking.set(result.gameId, SURVIVOR_UNSETTLED_REASON.NOT_YET_PLAYED);
    }
  }

  for (const pick of picks) {
    if (!aliveEntering.has(pick.memberId)) continue;
    // Non-null because the caller rejects a pick with no matching result before
    // reaching here.
    const result = resultsByGameId.get(pick.gameId)!;
    if (result.status !== GAME_STATUS.FINAL) continue;
    if (result.homeScore === null || result.awayScore === null) {
      blocking.set(pick.gameId, SURVIVOR_UNSETTLED_REASON.FINAL_WITHOUT_SCORES);
    }
  }

  return [...blocking].map(([gameId, reason]) => ({ gameId, reason }));
}

// The grade and its consequence together: which outcomes end a season is
// settlement's rule (an incorrect pick, and nothing else — a cancellation and
// a tie are both `push` and neither eliminates), and answering it once here
// keeps the complete and provisional paths from ever deciding it differently.
interface GradedSurvivorPick {
  outcome: SurvivorPickOutcome;
  eliminates: boolean;
}

function gradePick(
  caller: string,
  pick: SurvivorPickInput,
  result: SurvivorGameResult,
): GradedSurvivorPick {
  const graded = { pickId: pick.pickId, memberId: pick.memberId, gameId: pick.gameId };

  // A cancelled game is the one case that hands the team back, and the member
  // always survives it — a tie's consumed team below is about a game that was
  // played (spec §Game Mode 2 — Cancelled game).
  if (isUnplayedStatus(result.status)) {
    return {
      outcome: { ...graded, outcome: PICK_OUTCOME.PUSH, teamConsumed: false },
      eliminates: false,
    };
  }

  const margin = pickedTeamMargin(caller, pick, result);
  // A tie's push advances with the team consumed — the game was played, so
  // the team is spent, and the member survives. Fixed rather than
  // configurable (ADR-0033 cut the Push/Tie Resolution setting at this, its
  // default).
  const outcome = pickOutcomeForMargin(margin);
  return {
    outcome: { ...graded, outcome, teamConsumed: true },
    eliminates: outcome === PICK_OUTCOME.INCORRECT,
  };
}

// Positive if the picked team won, negative if it lost, zero on a tie.
function pickedTeamMargin(
  caller: string,
  pick: SurvivorPickInput,
  result: SurvivorGameResult,
): number {
  // Non-null by the completeness check above: a final game missing either score
  // blocks the week rather than reaching here.
  const homeScore = result.homeScore!;
  const awayScore = result.awayScore!;

  if (pick.teamId === result.homeTeamId) return homeScore - awayScore;
  if (pick.teamId === result.awayTeamId) return awayScore - homeScore;
  throw new Error(
    `${caller}: pick ${pick.pickId} rides team ${pick.teamId}, which is not playing in game ${pick.gameId}`,
  );
}
