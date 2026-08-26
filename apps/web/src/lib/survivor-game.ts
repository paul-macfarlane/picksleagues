import { PICK_OUTCOME, type GameStatus, type PickOutcome } from "@picksleagues/schemas";
import { terminalPickOutcome } from "@picksleagues/scoring";

/**
 * The outcome a Survivor pick will grade to, derived from its game's terminal
 * state ahead of settlement (FB-23). Survivor settles week-atomically
 * (ADR-0025), so a pick whose game finished Sunday holds no stored result
 * until the whole week ends — and a completed pick with nothing on it read as
 * unacknowledged. The verdict is settlement's own mapping — `gradePick` in
 * `packages/scoring/src/survivor.ts` grades through the same
 * `pickOutcomeForMargin` this calls via `terminalPickOutcome` — so it can
 * never disagree for a single pick; only week-level consequences
 * (elimination, revival, the team ledger) wait for the settled week. The
 * derivation is the verdict shown, so there is no unconfirmed reading —
 * Pick'em took the same stance in PKM-11 (`pickemPickGrade`), so both modes
 * show a verdict the moment a game ends.
 *
 * Null while the game is still ahead or in play, and on a final without scores
 * (a provider fault the next sync corrects) — the row keeps its ungraded
 * explanation for those.
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
  // The picked team's scoreboard margin — Survivor is straight-up only
  // (ADR-0026), so no spread. The same one subtraction as settlement's
  // `pickedTeamMargin`, kept as a copy rather than shared because the error
  // postures differ: settlement throws on a team outside its game (a loader
  // bug there), while here that is the caller's documented obligation —
  // `teamId` is "always one of this game's two" — not something to re-detect.
  const pickedHome = teamId === game.homeTeam.id;
  return terminalPickOutcome(game, (homeScore, awayScore) =>
    pickedHome ? homeScore - awayScore : awayScore - homeScore,
  );
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
