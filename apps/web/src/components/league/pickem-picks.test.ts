import { describe, expect, it } from "vitest";
import { PICKEM_PICK_SIDE } from "@picksleagues/schemas";
import { openSelections } from "./pickem-picks";

/**
 * The sheet's narrowing rule. Under ADR-0018 a member gets one submission per
 * week, so a selection that survives its game's kickoff doesn't cost them a
 * pick — it costs them the week, because the write path refuses the whole set
 * with `pick_locked`. The cases below pin the boundary rather than the
 * arithmetic.
 *
 * How complete a sheet *has to be* is not tested here on purpose: that rule is
 * `requiredPickemPickCount` in `packages/schemas`, shared with the API's write
 * path and table-driven there. A second home for it is how the two surfaces
 * would come to disagree.
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

  it.each([
    { name: "locked after it was made", slate: [LOCKED], gameId: "locked" },
    { name: "stopped being playable", slate: [CANCELLED], gameId: "cancelled" },
    { name: "is no longer in the slate", slate: [OPEN], gameId: "gone" },
  ])("drops a selection whose game $name", ({ slate, gameId }) => {
    expect(openSelections(slate, selecting(gameId)).size).toBe(0);
  });

  it("narrows a mixed map to only the open games, preserving each side", () => {
    const held = openSelections(
      [OPEN, LOCKED, CANCELLED],
      selecting("open", "locked", "cancelled"),
    );

    expect([...held.entries()]).toEqual([["open", PICKEM_PICK_SIDE.HOME]]);
  });
});
