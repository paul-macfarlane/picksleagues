import {
  GAME_STATUS,
  PICK_OUTCOME,
  PICK_TYPE,
  isUnplayedStatus,
  type GameStatus,
  type PickemPickSide,
  type PickOutcome,
  type PickType,
} from "@picksleagues/schemas";
import { pickMargin } from "@picksleagues/scoring";

/**
 * The verdict a pick row shows: the settled grade, else the one derived from
 * its game's terminal state (PKM-11, spec §Settled pick margin). Settlement
 * rides the score sync's cadence, so a final game's pick sits ungraded for up
 * to a sync interval — and a decided game showing nothing there reads as the
 * app not knowing something the scoreboard already says. The derivation
 * mirrors `settlePickemWeek`'s own mapping (cancelled → push, final scores →
 * the sign of `pickMargin`), so the settled grade that replaces it can never
 * disagree.
 *
 * Null when there is no verdict to show: the game is still ahead or in play,
 * it is final without scores (the provider fault an admin score override
 * corrects — settlement refuses that one too), or an ATS pick carries no
 * spread to measure against.
 */
export function pickemPickGrade(
  game: { status: GameStatus; homeScore: number | null; awayScore: number | null },
  pick: { side: PickemPickSide; spreadAtPick: number | null; outcome: PickOutcome | null },
  pickType: PickType,
): PickOutcome | null {
  if (pick.outcome) return pick.outcome;
  if (isUnplayedStatus(game.status)) return PICK_OUTCOME.PUSH;
  if (game.status !== GAME_STATUS.FINAL) return null;
  if (game.homeScore === null || game.awayScore === null) return null;

  const margin = pickMargin(pick, game.homeScore, game.awayScore, pickType);
  if (margin === null) return null;
  if (margin > 0) return PICK_OUTCOME.CORRECT;
  if (margin < 0) return PICK_OUTCOME.INCORRECT;
  return PICK_OUTCOME.PUSH;
}

/**
 * Where a pick stands, in the one phrasing its moment allows — the single home
 * for the rule that a *reading* and a *grade* are different claims.
 *
 * Both surfaces that show a pick beside a score (the entry grid's rows and the
 * week/pick detail) previously restated the status check, the null-score guard
 * and the `pickMargin` call inline, which is exactly how the two would come to
 * disagree about when a number may appear.
 *
 * Two moments say something, and they never overlap:
 *
 * - **In progress** → a provisional reading (see `provisionalMarginLabel`).
 * - **Graded** → the settled reading (see `settledMarginLabel`). Keyed on
 *   `pickemPickGrade` — settled *or* derived from the final score — so the
 *   window between a game ending and the settlement sweep landing reads in
 *   the past tense beside the derived badge that confirms it (PKM-11; this
 *   window used to show nothing, back when no badge existed to confirm a
 *   reading).
 *
 * Null when there is nothing honest to say: no scores yet, an ATS pick with no
 * spread to measure against, or a push — which has no margin to state whether it
 * landed exactly on the number or the game was cancelled out from under it.
 */
export function pickStandingLabel(
  game: { status: GameStatus; awayScore: number | null; homeScore: number | null },
  pick: { side: PickemPickSide; spreadAtPick: number | null; outcome: PickOutcome | null },
  pickType: PickType,
): string | null {
  if (game.awayScore === null || game.homeScore === null) return null;

  const graded = pickemPickGrade(game, pick, pickType) !== null;
  if (!graded && game.status !== GAME_STATUS.IN_PROGRESS) return null;

  const margin = pickMargin(pick, game.homeScore, game.awayScore, pickType);
  if (margin === null) return null;

  if (graded) return settledMarginLabel(margin, pickType);
  return provisionalMarginLabel(margin, pickType);
}

/**
 * How a graded pick's margin reads: the past tense of the reading the row
 * carried while its game was still running.
 *
 * This began as the bare magnitude ("by 10"), on the theory that the outcome
 * badge beside it owns the verdict and repeating it would only crowd the badge.
 * Wrong in practice: a lone number doesn't say what it measures, and what it
 * measures genuinely differs by pick type — 7.5 against the spread is points
 * relative to a number the member accepted, while 10 straight-up is points on
 * the scoreboard. Naming it costs one word and removes the guess.
 *
 * Tense is what keeps it from becoming a second verdict beside the badge:
 * "covering by 7.5" becomes "covered by 7.5", so a member watching a game
 * settle sees one sentence resolve rather than a new vocabulary appear.
 *
 * It describes this one pick and nothing else. Nothing aggregates it — ADR-0018
 * decision 4 removed the standings differential it used to feed — and it
 * survives on its own merits, as that ADR says.
 *
 * Null on a push, which is not an oversight: the ambiguity above is a property
 * of *numbers* without units, and a push has no number to qualify — so "pushed"
 * next to a badge already reading "Push" would be the one case where the words
 * really are pure duplication.
 */
export function settledMarginLabel(margin: number, pickType: PickType): string | null {
  if (margin === 0) return null;
  const magnitude = Math.abs(margin);
  if (pickType === PICK_TYPE.AGAINST_THE_SPREAD) {
    return margin > 0 ? `covered by ${magnitude}` : `short by ${magnitude}`;
  }
  return margin > 0 ? `won by ${magnitude}` : `lost by ${magnitude}`;
}

/**
 * Where an unfinished pick currently stands, phrased as a *reading* rather than
 * a verdict (spec §Data Freshness).
 *
 * Three deliberate constraints, because this sits one sync behind reality and
 * beside a settled grade that is final:
 *
 * 1. **A number, never a verdict word.** "Covering by 7.5" is self-evidently a
 *    snapshot; "Winning" reads as a fact, and a fact a sync interval stale is
 *    simply wrong. The number also does the work a member can't do in their
 *    head: applying a home-relative spread to an away-first score.
 * 2. **No colour and no glyph** at the call sites — `PICK_OUTCOME`'s green
 *    check and red cross mean "this graded", and a provisional badge borrowing
 *    them would erase that distinction in exactly the moment it matters.
 * 3. **Attached to the pick, not the game**, and rendered only while the game is
 *    in progress: before kickoff there is nothing to read, and afterwards the
 *    real grade has arrived and this must get out of its way.
 *
 * The margin itself comes from `packages/scoring`'s `pickMargin` — the same
 * arithmetic settlement grades on, so this can never contradict the outcome that
 * follows it.
 */
export function provisionalMarginLabel(margin: number, pickType: PickType): string {
  const magnitude = Math.abs(margin);
  if (pickType === PICK_TYPE.AGAINST_THE_SPREAD) {
    if (margin > 0) return `covering by ${magnitude}`;
    if (margin < 0) return `short by ${magnitude}`;
    // The app's own word for landing exactly on the number, matching what the
    // grade will say if it holds (`PICK_OUTCOME.PUSH` → "Push").
    return "pushing";
  }
  if (margin > 0) return `up ${magnitude}`;
  if (margin < 0) return `down ${magnitude}`;
  return "tied";
}

/**
 * The "Spread by <book>" credit line (PKM-9), rendered once per pick card and
 * once on the week detail — never per game row, since a slate prices from one
 * provider response and a per-row credit would repeat the same string.
 *
 * Null in SU leagues (no spread shown at all) and when none of the given games
 * carries a source: suppression is per-game server-side (null on an unpriced
 * game, and under an admin's `override_spread`, arch D15), and the credit line
 * composes that as "show it while at least one displayed game still has one" —
 * a whole slate's credit must not vanish because one game was corrected.
 */
export function spreadSourceCredit(
  games: readonly { spreadSource: string | null }[],
  pickType: PickType,
): string | null {
  if (pickType !== PICK_TYPE.AGAINST_THE_SPREAD) return null;
  const source = games.find((game) => game.spreadSource !== null)?.spreadSource;
  return source ? `Spread by ${source}` : null;
}

/**
 * A pick row's visual state (PKM UX feedback: "make submitted state obvious
 * inline"). One function drives the row's border/badge styling so the new
 * "picked" highlight and the pre-existing locked/unplayable badges — which
 * must stay visually distinct from it — can never drift out of sync with
 * each other. `locked`/`unplayable` take priority over `hasSelection`: a
 * submitted pick on a locked or pushed game is still rendered via its own
 * "Your pick" copy, not the freshly-picked highlight.
 */
export type PickRowState = "unplayable" | "locked" | "picked" | "open";

export function pickRowState(
  game: { pickable: boolean; locked: boolean },
  hasSelection: boolean,
): PickRowState {
  if (!game.pickable) return "unplayable";
  if (game.locked) return "locked";
  if (hasSelection) return "picked";
  return "open";
}
