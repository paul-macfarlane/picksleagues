import {
  GAME_STATUS,
  isUnplayedStatus,
  PICK_OUTCOME,
  PICK_TYPE,
  PICKEM_PICK_SIDE,
  PICKEM_PUSH_TIE_RESOLUTION,
  type GameStatus,
  type PickOutcome,
  type PickemPickSide,
  type PickType,
  type PickemPushTieResolution,
} from "@picksleagues/schemas";

/**
 * Pick'em settlement (spec §Game Mode 1 — Scoring, Tiebreakers, Cancellations).
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
  pushTieResolution: PickemPushTieResolution;
}

export interface PickemPickOutcome {
  pickId: string;
  memberId: string;
  gameId: string;
  outcome: PickOutcome;
  points: number;
  /**
   * Cumulative-margin tiebreaker input (spec §Tiebreakers): the picked side's
   * margin of victory/defeat in SU, or its margin relative to the spread in
   * ATS. Pushes contribute zero.
   */
  differential: number;
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

const PUSH_POINTS: Record<PickemPushTieResolution, number> = {
  [PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT]: 0.5,
  [PICKEM_PUSH_TIE_RESOLUTION.ZERO_POINTS]: 0,
  [PICKEM_PUSH_TIE_RESOLUTION.FULL_POINT]: 1,
};

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
 * **Caller obligation — week moves.** A provider week move is expressed as the
 * game's `week_id` changing, not as a status (see `GAME_STATUS.moved`, which is
 * admin-override-only). The input loader MUST therefore pass `status: moved`
 * for any pick whose `pickem_picks.week_id` no longer matches its game's
 * `week_id`; otherwise a moved game grades on its real result instead of
 * pushing, silently violating the spec. This function cannot detect it — it
 * never sees the pick's week.
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
      outcomes.push(pushOutcome(pick, settings));
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
    outcomes.push(gradedOutcome(pick, margin, settings));
  }

  return { outcomes, unsettled };
}

/**
 * The picked side's margin, on the scale the league's pick type scores against:
 * raw points in SU, points relative to the spread in ATS. Positive means the
 * pick won, zero means push/tie, negative means it lost — one number that
 * carries both the outcome and the tiebreaker differential.
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
  // `Object.is`-equal to it. This value is persisted as a tiebreaker
  // `differential` and formatted for display, so a tie must never leave here
  // carrying a sign that a strict comparison or a snapshot could trip over.
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

function gradedOutcome(
  pick: PickemPickInput,
  margin: number,
  settings: PickemScoringSettings,
): PickemPickOutcome {
  if (margin === 0) {
    return pushOutcome(pick, settings);
  }

  return {
    pickId: pick.pickId,
    memberId: pick.memberId,
    gameId: pick.gameId,
    outcome: margin > 0 ? PICK_OUTCOME.CORRECT : PICK_OUTCOME.INCORRECT,
    points: margin > 0 ? CORRECT_POINTS : INCORRECT_POINTS,
    differential: margin,
  };
}

// Pushes contribute zero to the tiebreaker regardless of how they arose (spec
// §Tiebreakers) — an exact-number ATS push and a cancelled game are the same
// zero here, even though only the former has a margin to speak of.
function pushOutcome(pick: PickemPickInput, settings: PickemScoringSettings): PickemPickOutcome {
  return {
    pickId: pick.pickId,
    memberId: pick.memberId,
    gameId: pick.gameId,
    outcome: PICK_OUTCOME.PUSH,
    points: PUSH_POINTS[settings.pushTieResolution],
    differential: 0,
  };
}
