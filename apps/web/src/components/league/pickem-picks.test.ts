import { describe, expect, it } from "vitest";
import { PICKEM_PICK_SIDE } from "@picksleagues/schemas";
import { hasOperableControl, openSelections, pickProgressLabel } from "./pickem-picks";

/**
 * Decides whether the save bar is shown at all, so the cases below are the
 * ones where a member would otherwise be left staring at a Save button that
 * can never enable.
 */
describe("hasOperableControl", () => {
  const OPEN = { id: "open", locked: false, pickable: true };
  const OTHER_OPEN = { id: "other-open", locked: false, pickable: true };
  const LOCKED = { id: "locked", locked: true, pickable: true };
  const CANCELLED = { id: "cancelled", locked: false, pickable: false };
  const none = new Map<string, "home" | "away">();
  const holding = (id: string) => new Map([[id, PICKEM_PICK_SIDE.HOME]]);

  it("is operable below the cap while any game is open", () => {
    expect(hasOperableControl([LOCKED, OPEN], none, false)).toBe(true);
  });

  it("is dead once every game has closed", () => {
    expect(hasOperableControl([LOCKED, CANCELLED], none, false)).toBe(false);
  });

  // The reported case: later kickoffs remain, but the member is out of picks
  // and every pick they hold has locked, so no button on the page can move.
  it("is dead at the cap when no held pick is on an open game", () => {
    expect(hasOperableControl([LOCKED, OPEN, OTHER_OPEN], none, true)).toBe(false);
  });

  // Still operable at the cap: giving up this pick is what frees the slot.
  it("stays operable at the cap when a held pick is on an open game", () => {
    expect(hasOperableControl([LOCKED, OPEN], holding("open"), true)).toBe(true);
  });

  it("is dead with no games at all", () => {
    expect(hasOperableControl([], none, false)).toBe(false);
  });
});

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
