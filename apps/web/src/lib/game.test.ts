import { describe, expect, it } from "vitest";
import { isClosedToPicks } from "./game";

describe("isClosedToPicks", () => {
  it.each([
    {
      name: "an unlocked, playable game is still open",
      game: { locked: false, pickable: true },
      expected: false,
    },
    { name: "kickoff closes it", game: { locked: true, pickable: true }, expected: true },
    {
      name: "a cancelled game closes it",
      game: { locked: false, pickable: false },
      expected: true,
    },
    {
      name: "both at once still closes it",
      game: { locked: true, pickable: false },
      expected: true,
    },
  ])("$name", ({ game, expected }) => {
    expect(isClosedToPicks(game)).toBe(expected);
  });
});
