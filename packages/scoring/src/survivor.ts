import {
  GAME_STATUS,
  isUnplayedStatus,
  PICK_OUTCOME,
  SURVIVOR_PUSH_TIE_RESOLUTION,
  type GameStatus,
  type PickOutcome,
  type SurvivorPushTieResolution,
} from "@picksleagues/schemas";

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
 * Survivor is straight-up only (ADR-0026), so nothing here consults a spread
 * and `pushTieResolution` decides exactly one thing: a tied final score. There
 * is no shared grading helper with `pickem.ts` for the same reason — with ATS
 * gone the whole arithmetic is one subtraction, and extracting it would leave
 * two callers sharing less code than the indirection costs.
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

/** The slice of `SurvivorSettings` that scoring actually consumes. */
export interface SurvivorScoringSettings {
  pushTieResolution: SurvivorPushTieResolution;
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
  settings: SurvivorScoringSettings,
): SurvivorWeekSettlement {
  const resultsByGameId = new Map(results.map((result) => [result.gameId, result]));
  for (const pick of picks) {
    if (!resultsByGameId.has(pick.gameId)) {
      throw new Error(
        `settleSurvivorWeek: pick ${pick.pickId} references game ${pick.gameId}, which is absent from the supplied results`,
      );
    }
  }

  const aliveEntering = new Set(aliveMemberIds);
  const pickByMemberId = new Map<string, SurvivorPickInput>();
  for (const pick of picks) {
    if (!aliveEntering.has(pick.memberId)) continue;
    if (pickByMemberId.has(pick.memberId)) {
      throw new Error(
        `settleSurvivorWeek: member ${pick.memberId} holds more than one pick for this week`,
      );
    }
    pickByMemberId.set(pick.memberId, pick);
  }

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

    const graded = gradePick(pick, resultsByGameId.get(pick.gameId)!, settings);
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
 * The week is settleable only once every game in it is terminal — final or
 * cancelled (ADR-0025 precondition (a)) — and every game a live pick depends on
 * carries the scores needed to grade it. A game nobody live picked may be a
 * data fault without holding the week: it decides nothing.
 */
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
    const result = resultsByGameId.get(pick.gameId)!;
    if (result.status !== GAME_STATUS.FINAL) continue;
    if (result.homeScore === null || result.awayScore === null) {
      blocking.set(pick.gameId, SURVIVOR_UNSETTLED_REASON.FINAL_WITHOUT_SCORES);
    }
  }

  return [...blocking].map(([gameId, reason]) => ({ gameId, reason }));
}

/**
 * The grade and its consequence together, because the two are decided by the
 * same fact and reading the consequence back off the grade would need the very
 * distinction this drops: a cancellation and a tie are both `push`, and only one
 * of them can end a season.
 */
interface GradedSurvivorPick {
  outcome: SurvivorPickOutcome;
  eliminates: boolean;
}

function gradePick(
  pick: SurvivorPickInput,
  result: SurvivorGameResult,
  settings: SurvivorScoringSettings,
): GradedSurvivorPick {
  const graded = { pickId: pick.pickId, memberId: pick.memberId, gameId: pick.gameId };

  // A cancelled game is the one case that hands the team back, and the member
  // always survives it — the tie setting is about a game that was played (spec
  // §Game Mode 2 — Cancelled game).
  if (isUnplayedStatus(result.status)) {
    return {
      outcome: { ...graded, outcome: PICK_OUTCOME.PUSH, teamConsumed: false },
      eliminates: false,
    };
  }

  const margin = pickedTeamMargin(pick, result);
  if (margin > 0) {
    return {
      outcome: { ...graded, outcome: PICK_OUTCOME.CORRECT, teamConsumed: true },
      eliminates: false,
    };
  }
  if (margin < 0) {
    return {
      outcome: { ...graded, outcome: PICK_OUTCOME.INCORRECT, teamConsumed: true },
      eliminates: true,
    };
  }

  // A tie: the one push a commissioner gets to rule on (spec §Survivor League
  // Settings). Either way the team is spent — the game was played.
  return {
    outcome: { ...graded, outcome: PICK_OUTCOME.PUSH, teamConsumed: true },
    eliminates: settings.pushTieResolution === SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE,
  };
}

/** Positive if the picked team won, negative if it lost, zero on a tie. */
function pickedTeamMargin(pick: SurvivorPickInput, result: SurvivorGameResult): number {
  // Non-null by the completeness check above: a final game missing either score
  // blocks the week rather than reaching here.
  const homeScore = result.homeScore!;
  const awayScore = result.awayScore!;

  if (pick.teamId === result.homeTeamId) return homeScore - awayScore;
  if (pick.teamId === result.awayTeamId) return awayScore - homeScore;
  throw new Error(
    `settleSurvivorWeek: pick ${pick.pickId} rides team ${pick.teamId}, which is not playing in game ${pick.gameId}`,
  );
}
