import { describe, expect, it } from "vitest";
import { PICKEM_PICK_SIDE } from "@picksleagues/schemas";
import { storedPriceSideFor } from "./pickem-game-row";

const base = {
  committedSide: PICKEM_PICK_SIDE.HOME,
  selectedSide: PICKEM_PICK_SIDE.HOME as
    (typeof PICKEM_PICK_SIDE)[keyof typeof PICKEM_PICK_SIDE] | undefined,
  editable: true,
  spreadsAccepted: false,
};

/**
 * The rule this pins: the stored spread belongs to the *committed* pick, not to
 * whichever button is lit.
 *
 * The bug it replaces keyed on the lit side, so switching teams handed the
 * newly-picked team the **inverse of the old line** (`-3.5` rendering as `+3.5`)
 * while the abandoned team took the live number — the two labels trading places
 * on a single click, neither of them true.
 */
describe("storedPriceSideFor", () => {
  it("marks the committed side while its pick is untouched", () => {
    expect(storedPriceSideFor(base)).toBe(PICKEM_PICK_SIDE.HOME);
  });

  it("marks nothing once the member switches teams — the holding is being given up", () => {
    expect(storedPriceSideFor({ ...base, selectedSide: PICKEM_PICK_SIDE.AWAY })).toBeNull();
  });

  it("marks nothing once the member clears the pick", () => {
    expect(storedPriceSideFor({ ...base, selectedSide: undefined })).toBeNull();
  });

  it("marks nothing once the latest spreads are accepted", () => {
    expect(storedPriceSideFor({ ...base, spreadsAccepted: true })).toBeNull();
  });

  it("marks nothing on a game the member never picked", () => {
    expect(storedPriceSideFor({ ...base, committedSide: undefined })).toBeNull();
  });

  /**
   * A closed row has no selection to compare against — `openSelections` drops
   * closed games — so keying on the selection alone would have un-frozen exactly
   * the picks that are most frozen.
   */
  it("keeps the committed side on a row that is no longer editable, with no selection", () => {
    expect(storedPriceSideFor({ ...base, editable: false, selectedSide: undefined })).toBe(
      PICKEM_PICK_SIDE.HOME,
    );
  });

  it("keeps it on a closed row even when spreads were accepted — a retained pick can't re-price", () => {
    expect(
      storedPriceSideFor({
        ...base,
        editable: false,
        selectedSide: undefined,
        spreadsAccepted: true,
      }),
    ).toBe(PICKEM_PICK_SIDE.HOME);
  });

  it("works the same for an away-side holding", () => {
    const away = { ...base, committedSide: PICKEM_PICK_SIDE.AWAY };
    expect(storedPriceSideFor({ ...away, selectedSide: PICKEM_PICK_SIDE.AWAY })).toBe(
      PICKEM_PICK_SIDE.AWAY,
    );
    expect(storedPriceSideFor({ ...away, selectedSide: PICKEM_PICK_SIDE.HOME })).toBeNull();
  });
});
