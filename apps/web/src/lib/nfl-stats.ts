/**
 * Display formatting for NFL record facts, shared by the matchup stats sheet
 * and the admin stats browser so "4-2" and "W3" can't drift between the
 * member and operator views of the same row.
 */

/** Ties shown only when present — "4-2", but "4-2-1". */
export function recordLabel(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/** Signed streak → "W3" / "L1"; zero (no games) is a dash. */
export function streakLabel(streak: number): string {
  if (streak === 0) return "—";
  return streak > 0 ? `W${streak}` : `L${-streak}`;
}
