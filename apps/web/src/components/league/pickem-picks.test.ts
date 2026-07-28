import { describe, expect, it } from "vitest";
import { pickProgressLabel } from "./pickem-picks";

/**
 * Pins the sticky action bar's progress phrasing (feedback: submitting a
 * 16-game slate shouldn't require scrolling to find the count) — the exact
 * string is also asserted literally by e2e/pickem-journey.sim.spec.ts, so a
 * wording change here must be a deliberate, visible edit to both.
 */
describe("pickProgressLabel", () => {
  it("renders the held count over the cap", () => {
    expect(pickProgressLabel(4, 4)).toBe("4 of 4 picks");
  });

  it("renders zero held picks", () => {
    expect(pickProgressLabel(0, 5)).toBe("0 of 5 picks");
  });

  it("renders a partial count", () => {
    expect(pickProgressLabel(2, 5)).toBe("2 of 5 picks");
  });
});
