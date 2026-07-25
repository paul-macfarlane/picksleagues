import { describe, expect, it } from "vitest";
import { synthesizeSpread } from "./sim-spread";

describe("synthesizeSpread", () => {
  // The property that makes a replay a repeatable test rather than a fresh
  // experiment on every import (ADR-0011).
  it("is deterministic for the same seed and result", () => {
    const first = synthesizeSpread("sim-nfl-2024-101", 27, 20);
    const second = synthesizeSpread("sim-nfl-2024-101", 27, 20);
    expect(first).toBe(second);
  });

  it("varies with the seed, so a whole season is not one repeated line", () => {
    const spreads = new Set(
      Array.from({ length: 40 }, (_, index) => synthesizeSpread(`sim-${index}`, 24, 17)),
    );
    expect(spreads.size).toBeGreaterThan(3);
  });

  it.each([
    { seed: "a", home: 31, away: 3 },
    { seed: "b", home: 24, away: 17 },
    { seed: "c", home: 20, away: 20 },
    { seed: "d", home: 10, away: 34 },
    { seed: "e", home: 0, away: 3 },
  ])("lands on the half-point grid within the plausible range ($seed)", ({ seed, home, away }) => {
    const spread = synthesizeSpread(seed, home, away);
    expect(spread).not.toBeNull();
    expect((spread as number) * 2).toBe(Math.round((spread as number) * 2));
    expect(Math.abs(spread as number)).toBeLessThanOrEqual(28);
  });

  // Home-relative, matching odds_snapshots.spread: negative = home favored.
  it("favors the side that won by a wide margin", () => {
    // Averaged over seeds so the assertion tests the margin term, not one draw
    // of the jitter.
    const homeBlowouts = Array.from({ length: 25 }, (_, i) =>
      synthesizeSpread(`home-${i}`, 42, 7),
    ) as number[];
    const awayBlowouts = Array.from({ length: 25 }, (_, i) =>
      synthesizeSpread(`away-${i}`, 7, 42),
    ) as number[];
    expect(Math.max(...homeBlowouts)).toBeLessThan(0);
    expect(Math.min(...awayBlowouts)).toBeGreaterThan(0);
  });

  it("clamps blowouts to a line that could actually have been posted", () => {
    const spread = synthesizeSpread("blowout", 200, 0);
    expect(spread).toBe(-28);
  });

  // A game that never happened has no line worth inventing.
  it.each([
    { home: null, away: 17 },
    { home: 24, away: null },
    { home: null, away: null },
  ])("returns null when the result is incomplete ($home-$away)", ({ home, away }) => {
    expect(synthesizeSpread("cancelled", home, away)).toBeNull();
  });

  // Golden pin (regression): ADR-0012 claims a re-import is byte-identical
  // across versions, which is only true if the exact numbers this function
  // produces never silently drift. These are the real output of the function
  // today, hard-coded — a tweak to MARGIN_WEIGHT, JITTER_POINTS, the hash, or
  // the rounding/clamping must fail this test, not just the "is deterministic"
  // property test above (which would still pass against a *different* but
  // still-deterministic implementation).
  it.each([
    { seed: "golden-1", home: 27, away: 17, expected: -4.5 },
    { seed: "golden-2", home: 20, away: 24, expected: 4 },
    { seed: "golden-3", home: 24, away: 20, expected: -1 },
    { seed: "golden-4", home: 30, away: 13, expected: -8.5 },
  ])(
    "pins the exact synthesized spread for ($seed, $home, $away)",
    ({ seed, home, away, expected }) => {
      expect(synthesizeSpread(seed, home, away)).toBe(expected);
    },
  );
});
