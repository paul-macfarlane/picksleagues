import { PICK_OUTCOME, type PickOutcome } from "@picksleagues/schemas";

/**
 * Standings derivation (spec §Game Mode 1 — Standings, Tiebreakers).
 *
 * Pure, and mode-agnostic on purpose: it consumes scored outcomes, not picks,
 * so Elimination and March Madness rank through the same two functions once
 * their scoring modules produce points and a differential. `PICK_OUTCOME` is
 * itself the shared outcome set (Pick'em grades against it and so does March
 * Madness), so tallying it here keeps that property.
 */

export interface ScoredOutcome {
  memberId: string;
  /** How the pick resolved — tallied into the W/L/P counts below. */
  outcome: PickOutcome;
  points: number;
  differential: number;
}

/** A member's settled record over the period. Display data, never a tiebreaker. */
export interface OutcomeCounts {
  wins: number;
  losses: number;
  pushes: number;
}

export interface StandingsEntry extends OutcomeCounts {
  memberId: string;
  points: number;
  differential: number;
}

const COUNT_KEY = {
  [PICK_OUTCOME.CORRECT]: "wins",
  [PICK_OUTCOME.INCORRECT]: "losses",
  [PICK_OUTCOME.PUSH]: "pushes",
} as const satisfies Record<PickOutcome, keyof OutcomeCounts>;

export interface RankedStandingsEntry extends StandingsEntry {
  rank: number;
}

/**
 * Totals per member over the supplied outcomes. Every member is returned, not
 * only those who scored: a member who submitted nothing has a real zero (spec
 * §Standings — "a week with no submission counts as zero toward the season
 * total"), and omitting them would silently drop them off the board.
 */
export function aggregateStandings(
  outcomes: readonly ScoredOutcome[],
  memberIds: readonly string[],
): StandingsEntry[] {
  const totals = new Map<string, StandingsEntry>(
    memberIds.map((memberId) => [
      memberId,
      { memberId, points: 0, differential: 0, wins: 0, losses: 0, pushes: 0 },
    ]),
  );

  for (const outcome of outcomes) {
    const entry = totals.get(outcome.memberId);
    // An outcome for a member who is not in the roster is a loader bug — a
    // membership can't be removed once the league starts (spec §Membership).
    if (!entry) {
      throw new Error(`aggregateStandings: outcome for unknown member ${outcome.memberId}`);
    }
    entry.points += outcome.points;
    entry.differential += outcome.differential;
    entry[COUNT_KEY[outcome.outcome]] += 1;
  }

  return [...totals.values()];
}

/**
 * Ranks entries by points, breaking ties on cumulative margin differential
 * (spec §Tiebreakers). Members level on both **share** a rank, and the next
 * rank skips accordingly — standard competition ranking, so two members tied
 * for 1st are followed by 3rd, not 2nd.
 *
 * The W/L/P counts deliberately take no part in the ordering: the spec exhausts
 * its tiebreakers at the differential, so a better record breaks nothing.
 *
 * Returned in rank order, which is also the order a leaderboard renders.
 */
export function rankStandings(entries: readonly StandingsEntry[]): RankedStandingsEntry[] {
  const sorted = [...entries].sort(
    (a, b) => b.points - a.points || b.differential - a.differential,
  );

  const ranked: RankedStandingsEntry[] = [];
  let rank = 0;
  sorted.forEach((entry, index) => {
    const previous = sorted[index - 1];
    // Only a tie on BOTH keys shares a rank — the spec exhausts its tiebreakers
    // at the differential and explicitly leaves the remainder tied.
    const tiedWithPrevious =
      previous !== undefined &&
      previous.points === entry.points &&
      previous.differential === entry.differential;
    if (!tiedWithPrevious) rank = index + 1;
    ranked.push({ ...entry, rank });
  });

  return ranked;
}
