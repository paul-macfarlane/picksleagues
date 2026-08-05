import { describe, expect, it } from "vitest";
import { requiredPickemPickCount } from "./pickem";

describe("requiredPickemPickCount", () => {
  it.each([
    {
      label: "a full slate under the cap: every game is required",
      cap: 5,
      games: [
        { locked: false, pickable: true },
        { locked: false, pickable: true },
        { locked: false, pickable: true },
      ],
      expected: 3,
    },
    {
      label: "a slate longer than the cap: the cap wins",
      cap: 2,
      games: [
        { locked: false, pickable: true },
        { locked: false, pickable: true },
        { locked: false, pickable: true },
      ],
      expected: 2,
    },
    {
      label: "a locked game is forgone, not required (ADR-0018 decision 2)",
      cap: 5,
      games: [
        { locked: true, pickable: true },
        { locked: false, pickable: true },
        { locked: false, pickable: true },
      ],
      expected: 2,
    },
    {
      label: "a cancelled game never raises the requirement",
      cap: 5,
      games: [
        { locked: false, pickable: false },
        { locked: false, pickable: true },
      ],
      expected: 1,
    },
    {
      label: "the cap still binds once late kickoffs shrink the slate below it",
      cap: 2,
      games: [
        { locked: true, pickable: true },
        { locked: true, pickable: true },
        { locked: false, pickable: true },
      ],
      expected: 1,
    },
    {
      label: "a week whose games have all kicked off requires nothing",
      cap: 3,
      games: [
        { locked: true, pickable: true },
        { locked: true, pickable: true },
      ],
      expected: 0,
    },
    { label: "an empty slate requires nothing", cap: 3, games: [], expected: 0 },
  ])("$label", ({ cap, games, expected }) => {
    expect(requiredPickemPickCount(cap, games)).toBe(expected);
  });
});
