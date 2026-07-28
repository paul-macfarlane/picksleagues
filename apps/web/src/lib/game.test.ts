import { describe, expect, it } from "vitest";
import { pickRowState } from "./game";

describe("pickRowState", () => {
  it.each([
    {
      name: "unplayable overrides a selection",
      game: { pickable: false, locked: false },
      hasSelection: true,
      expected: "unplayable",
    },
    {
      name: "locked overrides a selection",
      game: { pickable: true, locked: true },
      hasSelection: true,
      expected: "locked",
    },
    {
      name: "an unlocked, pickable game with a selection reads as picked",
      game: { pickable: true, locked: false },
      hasSelection: true,
      expected: "picked",
    },
    {
      name: "an unlocked, pickable game with no selection is open",
      game: { pickable: true, locked: false },
      hasSelection: false,
      expected: "open",
    },
    {
      name: "unplayable takes priority over locked",
      game: { pickable: false, locked: true },
      hasSelection: false,
      expected: "unplayable",
    },
  ])("$name", ({ game, hasSelection, expected }) => {
    expect(pickRowState(game, hasSelection)).toBe(expected);
  });
});
