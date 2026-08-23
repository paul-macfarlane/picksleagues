import {
  GAME_STATUS,
  isUnplayedStatus,
  PICK_OUTCOME,
  type GameStatus,
  type PickOutcome,
} from "@picksleagues/schemas";

/**
 * The single home for how a margin becomes a verdict — shared by both modes'
 * settlement and, through `terminalPickOutcome`, both of the SPA's derived
 * badges (FB-23, PKM-11). Spec §Settled pick margin promises a derived
 * reading can never be contradicted by the grade that replaces it; keeping
 * the mapping in one module is what makes that promise structural rather than
 * a test's opinion about two copies. The *gating* — which terminal states
 * allow deriving a verdict at all — is shared only by the two SPA callers:
 * settlement keeps its own guards, because it must classify each refusal
 * (unsettled reasons, week-level blocking) where a derivation just declines.
 */

/**
 * A played game's margin, graded (spec §Game Mode 1 — Scoring; §Game Mode 2 —
 * ties advance, ADR-0033). Callers: `settlePickemWeek`'s grading and
 * `settleSurvivorWeek`'s `gradePick`, plus both client derivations through
 * `terminalPickOutcome`. The margin is on whatever scale the mode scores —
 * spread-relative for ATS Pick'em (`pickMargin`), the picked team's raw
 * scoreboard margin otherwise — and only its sign is read here.
 */
export function pickOutcomeForMargin(margin: number): PickOutcome {
  if (margin > 0) return PICK_OUTCOME.CORRECT;
  if (margin < 0) return PICK_OUTCOME.INCORRECT;
  return PICK_OUTCOME.PUSH;
}

/**
 * The verdict derivable from a game's terminal state ahead of settlement —
 * what the SPA shows in the window between a game ending and the settle sweep
 * landing (FB-23, PKM-11; spec §Settled pick margin). Cancelled → push (the
 * game will never be played this week, spec §Cancellations & Postponements),
 * final with scores → the margin's sign, everything else → null: still ahead
 * or in play, or final without scores — the provider fault an admin score
 * override corrects, and the same case settlement refuses to grade.
 *
 * The gating is the SPA's alone, but it answers to settlement's refusals: the
 * unplayed / non-final / missing-scores conditions here are the ones
 * `settlePickemWeek` walks per pick, and `settleSurvivorWeek` splits — its
 * grading pushes cancelled picks in place, while non-final and missing-scores
 * hold the whole week (`blockingGames`) where this declines one pick. It
 * lives beside both in this package so a change to either guard set is a
 * diff in this one's sightline.
 *
 * `marginOnScores` is the mode's own arithmetic over the resolved scores —
 * `pickMargin` for Pick'em, the picked team's scoreboard margin for Survivor.
 * It may return null when there is nothing to measure against (an ATS pick
 * carrying no spread): that derives to nothing here, where settlement treats
 * it as a write-path bug and throws.
 */
export function terminalPickOutcome(
  game: { status: GameStatus; homeScore: number | null; awayScore: number | null },
  marginOnScores: (homeScore: number, awayScore: number) => number | null,
): PickOutcome | null {
  if (isUnplayedStatus(game.status)) return PICK_OUTCOME.PUSH;
  if (game.status !== GAME_STATUS.FINAL) return null;
  if (game.homeScore === null || game.awayScore === null) return null;

  const margin = marginOnScores(game.homeScore, game.awayScore);
  if (margin === null) return null;
  return pickOutcomeForMargin(margin);
}
