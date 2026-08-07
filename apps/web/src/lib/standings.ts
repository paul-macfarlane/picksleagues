// How a shared rank renders, in one place. Members level on points share a rank
// and there is no tiebreaker behind it (spec §Standings, ADR-0018 decision 4),
// so every surface that shows a rank has to say the rank is shared rather than
// silently renumbering tied members 1, 2, 3.
//
// Homed here rather than in the standings table because two surfaces render the
// same rank — the board itself and the week/pick detail's member headers — and
// each needs both halves of the rule. Keeping the label in a component module
// meant its sibling imported a formatter from a table it doesn't render, and
// built the counts a second way to feed it.
//
// Deliberately mode-agnostic (a rank with ties is not a Pick'em idea), matching
// `packages/scoring/src/standings.ts`, so Elimination and March Madness render
// their boards through the same rule.

/** How many members hold each rank — the input `rankLabel` needs to spot a tie. */
export function sharedRankCounts(rows: readonly { rank: number }[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.rank, (counts.get(row.rank) ?? 0) + 1);
  return counts;
}

export function rankLabel(rank: number, sharedCounts: Map<number, number>): string {
  return (sharedCounts.get(rank) ?? 0) > 1 ? `T-${rank}` : `${rank}`;
}
