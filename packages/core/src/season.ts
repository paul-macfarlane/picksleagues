/**
 * NFL seasons are labeled by the year they start in and run Aug (regular
 * season kickoff) through Feb (Super Bowl). Jan/Feb belong to the *prior*
 * season's postseason tail, so a `now` in Jan–Jul maps back to `year - 1`;
 * Aug–Dec maps to the current UTC year. Pure function of the given instant —
 * callers pass `clock.now()` (arch D13); this module never reads time itself.
 */
export function nflSeasonYearFor(now: Date): number {
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth(); // 0-indexed: 0 = January, 7 = August
  const isAugustThroughDecember = utcMonth >= 7;
  return isAugustThroughDecember ? utcYear : utcYear - 1;
}
