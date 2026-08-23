import {
  GAME_STATUS,
  PICK_OUTCOME,
  isUnplayedStatus,
  type GameStatus,
  type PickOutcome,
} from "@picksleagues/schemas";

/**
 * The outcome a Survivor pick will grade to, derived from its game's terminal
 * state ahead of settlement (FB-23). Survivor settles week-atomically
 * (ADR-0025), so a pick whose game finished Sunday holds no stored result
 * until the whole week ends — and a completed pick with nothing on it read as
 * unacknowledged. This mirrors settlement's per-pick mapping (`gradePick` in
 * `packages/scoring/src/survivor.ts`: cancelled → push, win → correct, tie →
 * push, loss → incorrect), which can never disagree with it for a single pick;
 * only week-level consequences (elimination, revival, the team ledger) wait for
 * the settled week. Deliberately a different stance from Pick'em's
 * `pickStandingLabel`, which stays silent between final and settlement — here
 * the derivation *is* the verdict shown, so there is no unconfirmed reading.
 *
 * Null while the game is still ahead or in play, and on a final without scores
 * (the provider fault an admin score override corrects) — the row keeps its
 * ungraded explanation for those.
 */
export function survivorProvisionalOutcome(
  game: {
    status: GameStatus;
    homeScore: number | null;
    awayScore: number | null;
    homeTeam: { id: string };
    awayTeam: { id: string };
  },
  teamId: string,
): PickOutcome | null {
  if (isUnplayedStatus(game.status)) return PICK_OUTCOME.PUSH;
  if (game.status !== GAME_STATUS.FINAL) return null;
  if (game.homeScore === null || game.awayScore === null) return null;

  const pickedHome = teamId === game.homeTeam.id;
  const own = pickedHome ? game.homeScore : game.awayScore;
  const opposing = pickedHome ? game.awayScore : game.homeScore;
  if (own > opposing) return PICK_OUTCOME.CORRECT;
  if (own < opposing) return PICK_OUTCOME.INCORRECT;
  return PICK_OUTCOME.PUSH;
}

/** The shape a survivor board pick entry needs to carry for grading here. */
export interface SurvivorGradablePick {
  teamId: string | null;
  outcome: PickOutcome | null;
  game: {
    status: GameStatus;
    homeScore: number | null;
    awayScore: number | null;
    homeTeamId: string;
    awayTeamId: string;
  } | null;
}

/**
 * How many weeks a member has come through, as the board's one numeral: the
 * settled picks that did not eliminate them — a win, or a push, since ties
 * advance (ADR-0033). Settled only, never the derived grade, so the number
 * moves when "last updated" does and not before; a revival shows as its own
 * pill rather than as a week survived, because the member's pick that week
 * lost. Counts are out-row facts too: how far someone got is the board's
 * subject (spec §Standings View).
 */
export function survivorWeeksSurvived(picks: readonly { outcome: PickOutcome | null }[]): number {
  return picks.filter(
    (pick) => pick.outcome === PICK_OUTCOME.CORRECT || pick.outcome === PICK_OUTCOME.PUSH,
  ).length;
}

/**
 * A board pick's verdict for display: the settled grade, else the one derived
 * from its game's terminal state (`survivorProvisionalOutcome`) — the two can
 * never disagree for a single pick. Null for a withheld pick (no team, no
 * game) or an undecided one.
 */
export function survivorPickGrade(pick: SurvivorGradablePick): PickOutcome | null {
  if (pick.outcome) return pick.outcome;
  if (!pick.game || !pick.teamId) return null;
  return survivorProvisionalOutcome(
    {
      status: pick.game.status,
      homeScore: pick.game.homeScore,
      awayScore: pick.game.awayScore,
      homeTeam: { id: pick.game.homeTeamId },
      awayTeam: { id: pick.game.awayTeamId },
    },
    pick.teamId,
  );
}

/**
 * Whether the everyone-out revival (spec §Game Mode 2) is still on the table
 * for the week: false the moment any alive member's pick has already secured
 * survival — a win, or a push (ties advance, ADR-0033; cancellations survive).
 * A missing, hidden, or still-undecided pick keeps it possible — that member's
 * fate is simply not known yet. The definitive end of the state is still the
 * server's (ADR-0028's provisional elimination flips doomed members to Out);
 * this is the display-side mirror so a "revival possible" claim can't stand
 * beside a row whose derived win already disproves it.
 */
export function survivorRevivalStillPossible(
  aliveCurrentPicks: ReadonlyArray<SurvivorGradablePick | null>,
): boolean {
  return !aliveCurrentPicks.some((pick) => {
    if (!pick) return false;
    const grade = survivorPickGrade(pick);
    return grade === PICK_OUTCOME.CORRECT || grade === PICK_OUTCOME.PUSH;
  });
}
