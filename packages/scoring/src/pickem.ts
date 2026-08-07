import {
  GAME_STATUS,
  isUnplayedStatus,
  PICK_OUTCOME,
  PICK_TYPE,
  PICKEM_PICK_SIDE,
  type GameStatus,
  type PickOutcome,
  type PickemPickSide,
  type PickType,
} from "@picksleagues/schemas";

/**
 * Pick'em settlement (spec §Game Mode 1 — Scoring, Standings, Cancellations).
 *
 * Pure by rule: plain data in, plain data out, no clock and no I/O. Everything
 * time-derived (has this game kicked off, is this week over) is already
 * collapsed into the `status` the caller passes, and override precedence
 * (`override_* ?? provider_*`, arch D15) is resolved by the caller's input
 * loader — this module never sees a provider field.
 */

/** A member's single pick, as stored on `pickem_picks`. */
export interface PickemPickInput {
  pickId: string;
  memberId: string;
  gameId: string;
  side: PickemPickSide;
  /**
   * The home-relative spread this pick was locked in against (arch §Spread
   * strategy). Required in ATS leagues, meaningless (and ignored) in SU ones.
   */
  spreadAtPick: number | null;
}

/** A game's settled truth, with overrides already resolved by the caller. */
export interface PickemGameResult {
  gameId: string;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
}

/** The slice of `PickemSettings` that scoring actually consumes. */
export interface PickemScoringSettings {
  pickType: PickType;
}

export interface PickemPickOutcome {
  pickId: string;
  memberId: string;
  gameId: string;
  outcome: PickOutcome;
  points: number;
}

/**
 * Why a pick produced no result. `not_yet_played` is the ordinary case — the
 * game has not reached a terminal state, so the nightly sweep will settle it
 * later. `final_without_scores` is a provider data fault: the game claims to be
 * over but carries no score, so it is surfaced rather than graded against a
 * missing number, and an admin score override corrects it (arch §Overrides).
 */
export const PICKEM_UNSETTLED_REASON = {
  NOT_YET_PLAYED: "not_yet_played",
  FINAL_WITHOUT_SCORES: "final_without_scores",
} as const;

export type PickemUnsettledReason =
  (typeof PICKEM_UNSETTLED_REASON)[keyof typeof PICKEM_UNSETTLED_REASON];

export interface PickemUnsettledPick {
  pickId: string;
  gameId: string;
  reason: PickemUnsettledReason;
}

export interface PickemWeekSettlement {
  outcomes: PickemPickOutcome[];
  unsettled: PickemUnsettledPick[];
}

/**
 * What a push is worth, always (spec §Game Mode 1 — Scoring). Half a point is
 * the rule rather than a league setting: ADR-0018 removed the configurable
 * resolution, so there is nothing here for a commissioner to choose.
 */
export const PICKEM_PUSH_POINTS = 0.5;

const CORRECT_POINTS = 1;
const INCORRECT_POINTS = 0;

/**
 * Settles one league-week's picks.
 *
 * Scope note: this grades exactly the picks it is handed. Picks-per-week caps
 * and the "everyone picks every game in a short week" rule are pick-entry
 * validation (PKM-2), not scoring — enforcing them again here would silently
 * mask a write-path bug instead of surfacing it. Unpicked slots simply have no
 * pick row and therefore score nothing (spec §Missed/partial weeks).
 *
 * @throws if a pick references a game absent from `results`, or an ATS pick
 * carries no spread. Both are loader/write-path bugs: the pick endpoint refuses
 * ATS submissions without a current spread, and a settings change that would
 * strand existing picks resets them (`updateLeague`).
 */
export function settlePickemWeek(
  picks: readonly PickemPickInput[],
  results: readonly PickemGameResult[],
  settings: PickemScoringSettings,
): PickemWeekSettlement {
  const resultsByGameId = new Map(results.map((result) => [result.gameId, result]));
  const outcomes: PickemPickOutcome[] = [];
  const unsettled: PickemUnsettledPick[] = [];

  for (const pick of picks) {
    const result = resultsByGameId.get(pick.gameId);
    if (!result) {
      throw new Error(
        `settlePickemWeek: pick ${pick.pickId} references game ${pick.gameId}, which is absent from the supplied results`,
      );
    }

    if (isUnplayedStatus(result.status)) {
      outcomes.push(pushOutcome(pick));
      continue;
    }

    if (result.status !== GAME_STATUS.FINAL) {
      unsettled.push({
        pickId: pick.pickId,
        gameId: pick.gameId,
        reason: PICKEM_UNSETTLED_REASON.NOT_YET_PLAYED,
      });
      continue;
    }

    if (result.homeScore === null || result.awayScore === null) {
      unsettled.push({
        pickId: pick.pickId,
        gameId: pick.gameId,
        reason: PICKEM_UNSETTLED_REASON.FINAL_WITHOUT_SCORES,
      });
      continue;
    }

    const margin = marginForPick(pick, result.homeScore, result.awayScore, settings.pickType);
    outcomes.push(gradedOutcome(pick, margin));
  }

  return { outcomes, unsettled };
}

/**
 * The picked side's margin, on the scale the league's pick type scores against:
 * raw points in SU, points relative to the spread in ATS. Positive means the
 * pick won, zero means push/tie, negative means it lost — one number that
 * carries both the grade and how far it landed either way.
 *
 * Exported because the UI shows a member where an *unfinished* pick currently
 * stands (spec §Data Freshness — a provisional reading of the last sync, never a
 * verdict), and that reading must be the same arithmetic settlement will later
 * grade on. Computing it twice is how "covering by 3" becomes "Incorrect" with
 * no score change in between, which would cost more trust than the indicator
 * buys. Applying it to a non-final score is the caller's call, not this
 * function's: it is pure arithmetic over whatever score it is handed.
 *
 * Null only when an ATS pick carries no spread, which has nothing to compare
 * against. In settlement that is a loader bug (see `settlePickemWeek`); on a
 * read path it simply means there is nothing to show.
 */
export function pickMargin(
  pick: { side: PickemPickSide; spreadAtPick: number | null },
  homeScore: number,
  awayScore: number,
  pickType: PickType,
): number | null {
  const homeMargin = homeScore - awayScore;
  let margin: number;

  if (pickType === PICK_TYPE.STRAIGHT_UP) {
    margin = pick.side === PICKEM_PICK_SIDE.HOME ? homeMargin : -homeMargin;
  } else {
    if (pick.spreadAtPick === null) return null;
    // Spreads are home-relative (negative = home favored), so the home side's
    // result against the number is margin + spread, and the away side's is its
    // mirror image.
    const homeAgainstSpread = homeMargin + pick.spreadAtPick;
    margin = pick.side === PICKEM_PICK_SIDE.HOME ? homeAgainstSpread : -homeAgainstSpread;
  }

  // Negating a zero margin yields `-0` — numerically zero, but not
  // `Object.is`-equal to it, and formatted as "-0" for the member. A level
  // margin must never leave here carrying a sign a display or a strict
  // comparison could trip over.
  return margin === 0 ? 0 : margin;
}

function marginForPick(
  pick: PickemPickInput,
  homeScore: number,
  awayScore: number,
  pickType: PickType,
): number {
  const margin = pickMargin(pick, homeScore, awayScore, pickType);
  if (margin === null) {
    throw new Error(
      `settlePickemWeek: pick ${pick.pickId} is in an against-the-spread league but carries no spread`,
    );
  }
  return margin;
}

function gradedOutcome(pick: PickemPickInput, margin: number): PickemPickOutcome {
  if (margin === 0) {
    return pushOutcome(pick);
  }

  return {
    pickId: pick.pickId,
    memberId: pick.memberId,
    gameId: pick.gameId,
    outcome: margin > 0 ? PICK_OUTCOME.CORRECT : PICK_OUTCOME.INCORRECT,
    points: margin > 0 ? CORRECT_POINTS : INCORRECT_POINTS,
  };
}

// Every push scores the same half point however it arose — an exact-number ATS
// push, a tied SU game, and a cancelled game are indistinguishable here.
function pushOutcome(pick: PickemPickInput): PickemPickOutcome {
  return {
    pickId: pick.pickId,
    memberId: pick.memberId,
    gameId: pick.gameId,
    outcome: PICK_OUTCOME.PUSH,
    points: PICKEM_PUSH_POINTS,
  };
}
