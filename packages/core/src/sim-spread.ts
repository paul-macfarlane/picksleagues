/**
 * Spread synthesis for replayed seasons (SIM-6, ADR-0011 acceptance criterion).
 *
 * ESPN's historical feeds strip odds, so a replayed past season arrives with no
 * spreads at all — and ATS scoring is unexercisable without them. These are
 * therefore invented, but invented *deterministically*: the same season imported
 * twice produces byte-identical spreads, which is what keeps a replay a
 * repeatable test rather than a new experiment each run (arch D14).
 */

// NFL spreads are quoted on a half-point grid.
const SPREAD_GRID = 0.5;
// Beyond this the number stops resembling a real line; blowout margins would
// otherwise synthesize absurd spreads.
const MAX_SPREAD = 28;
// How much of the actual margin the line "predicted". Below 1 so favorites
// routinely fail to cover — an all-favorites-cover season would exercise only
// half the ATS rules.
const MARGIN_WEIGHT = 0.6;
// Total width of the seeded noise, in points. Wide enough that the line is not a
// function of the result alone (which would make every pick trivially winnable),
// narrow enough that spreads still track which team was better.
const JITTER_POINTS = 7;

/**
 * FNV-1a over the seed, mapped to [0, 1). Any stable string hash would do; the
 * requirement is only that it is pure and dependency-free — `Math.random` would
 * break re-import reproducibility.
 */
function seededUnitInterval(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    // FNV prime, via shifts so the result stays in 32-bit range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

function roundToGrid(value: number): number {
  return Math.round(value / SPREAD_GRID) * SPREAD_GRID;
}

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * A plausible pre-game line for a game whose result is already known.
 * Home-team-relative, matching `odds_snapshots.spread`: negative means the home
 * team is favored, so a home team winning by more than `-spread` covers.
 *
 * Returns null when the game has no result to derive from (a cancelled or
 * postponed fixture) — no line is better than a fabricated one for a game that
 * never happened.
 */
export function synthesizeSpread(
  seed: string,
  finalHomeScore: number | null,
  finalAwayScore: number | null,
): number | null {
  if (finalHomeScore === null || finalAwayScore === null) {
    return null;
  }
  const homeMargin = finalHomeScore - finalAwayScore;
  const jitter = (seededUnitInterval(seed) - 0.5) * JITTER_POINTS;
  // Negated on the way out: a positive home margin means the home team was the
  // better side, which a line expresses as a negative number.
  return clamp(roundToGrid(-(homeMargin * MARGIN_WEIGHT + jitter)), MAX_SPREAD);
}
