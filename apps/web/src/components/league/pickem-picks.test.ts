import { describe, expect, it } from "vitest";
import { PICKEM_PICK_SIDE } from "@picksleagues/schemas";
import { openSelections, pickProgressLabel } from "./pickem-picks";

/**
 * The editor's half of the "held pick" count. It must stay exactly
 * complementary to the retained map — a pick counted by both produced the
 * reported "8 of 5 picks", and one counted by neither would undercount just as
 * wrongly — so these cases pin the boundary rather than the arithmetic.
 */
describe("openSelections", () => {
  const OPEN = { id: "open", locked: false, pickable: true };
  const LOCKED = { id: "locked", locked: true, pickable: true };
  const CANCELLED = { id: "cancelled", locked: false, pickable: false };

  function selecting(...gameIds: string[]) {
    return new Map(gameIds.map((id) => [id, PICKEM_PICK_SIDE.HOME]));
  }

  it("keeps a selection whose game is still open", () => {
    expect([...openSelections([OPEN], selecting("open")).keys()]).toEqual(["open"]);
  });

  it("drops a selection whose game locked after it was made", () => {
    expect(openSelections([LOCKED], selecting("locked")).size).toBe(0);
  });

  it("drops a selection whose game stopped being playable", () => {
    expect(openSelections([CANCELLED], selecting("cancelled")).size).toBe(0);
  });

  // The game moved out of the week entirely (ADR-0015) — the pick is retained
  // server-side and rendered from its own list, so the editor must not also
  // hold it.
  it("drops a selection on a game that is no longer in the slate", () => {
    expect(openSelections([OPEN], selecting("gone")).size).toBe(0);
  });

  it("narrows a mixed map to only the open games, preserving each side", () => {
    const held = openSelections(
      [OPEN, LOCKED, CANCELLED],
      selecting("open", "locked", "cancelled"),
    );

    expect([...held.entries()]).toEqual([["open", PICKEM_PICK_SIDE.HOME]]);
  });
});

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
