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
 * moves when "last updated" does and not before; a revival shows as a tag on
 * the pick it saved rather than as a week survived, because that pick lost. Counts are out-row facts too: how far someone got is the board's
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

/** How the everyone-out revival (spec §Game Mode 2) stands for the current week. */
export const SURVIVOR_REVIVAL_OUTLOOK = {
  RULED_OUT: "ruled_out",
  POSSIBLE: "possible",
  CERTAIN: "certain",
} as const;
export type SurvivorRevivalOutlook =
  (typeof SURVIVOR_REVIVAL_OUTLOOK)[keyof typeof SURVIVOR_REVIVAL_OUTLOOK];

/**
 * Where the everyone-out revival stands for the week, from the alive members'
 * current picks. Ruled out the moment any alive member's pick has secured
 * survival — a win, or a push (ties advance, ADR-0033; cancellations survive).
 * Certain once every alive member's pick has a derived loss: a pick locks at
 * its game's kickoff, so nothing left in the week can save any of them, and
 * the rule revives them all. A missing, hidden, or still-undecided pick keeps
 * it merely possible — that member's fate is not known yet.
 *
 * `priorWeeksSettled` is the caller's obligation: whether settlement has
 * graded every earlier week. Settlement replays weeks in order and stops at
 * the first it can't finish (ADR-0025), so until then the alive set is not the
 * one entering this week — members a stuck earlier week will eliminate still
 * read alive, and their loss here revives nobody. Certain also stops short of
 * a later correction (a final re-marked cancelled, a score fix), which every
 * derived grade shares. The definitive answer is settlement's; this is the
 * display-side mirror so the board's claim can't contradict a row whose
 * derived grade already decides it.
 */
export function survivorRevivalOutlook(
  aliveCurrentPicks: ReadonlyArray<SurvivorGradablePick | null>,
  priorWeeksSettled: boolean,
): SurvivorRevivalOutlook {
  const grades = aliveCurrentPicks.map((pick) => (pick ? survivorPickGrade(pick) : null));
  if (grades.some((grade) => grade === PICK_OUTCOME.CORRECT || grade === PICK_OUTCOME.PUSH)) {
    return SURVIVOR_REVIVAL_OUTLOOK.RULED_OUT;
  }
  if (
    priorWeeksSettled &&
    grades.length > 0 &&
    grades.every((grade) => grade === PICK_OUTCOME.INCORRECT)
  ) {
    return SURVIVOR_REVIVAL_OUTLOOK.CERTAIN;
  }
  return SURVIVOR_REVIVAL_OUTLOOK.POSSIBLE;
}

/**
 * The weeks the everyone-out revival saved this member in, so a revived pick
 * can read as one rather than as the loss that ended them. A settled loss in
 * any week but the one that eliminated them is a loss the rule reversed:
 * settlement grades a loss that nobody's survival outlived as elimination, and
 * a pick by a member already out grades to nothing (`packages/scoring`'s
 * `settleSurvivorWeek`), so no other settled loss can sit outside that week.
 * `certainWeekId` adds the current week's revival ahead of settlement — the
 * week `survivorRevivalOutlook` calls certain and this member's pick lost —
 * the same as every derived grade on the board.
 *
 * A revival from a *missed* pick has no pick to mark, so it isn't here: the
 * history lists only weeks the member picked (`revivedCount` still counts it).
 */
export function survivorRevivedWeekIds(
  member: {
    eliminatedWeekId: string | null;
    picks: readonly { weekId: string; outcome: PickOutcome | null }[];
  },
  certainWeekId: string | null,
): ReadonlySet<string> {
  const weekIds = new Set(
    member.picks
      .filter(
        (pick) =>
          pick.outcome === PICK_OUTCOME.INCORRECT && pick.weekId !== member.eliminatedWeekId,
      )
      .map((pick) => pick.weekId),
  );
  if (certainWeekId) weekIds.add(certainWeekId);
  return weekIds;
}
