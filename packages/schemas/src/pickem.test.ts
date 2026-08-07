import { describe, expect, it } from "vitest";
import { PICK_TYPE } from "./pick-type";
import { requiredPickemPickCount } from "./pickem";

// A game the write path would accept: unlocked, playable, priced. Each case
// below states only what it changes about that.
const SUBMITTABLE = { locked: false, pickable: true, spread: -3 };

describe("requiredPickemPickCount", () => {
  it.each([
    {
      label: "a full slate under the cap: every game is required",
      cap: 5,
      games: [SUBMITTABLE, SUBMITTABLE, SUBMITTABLE],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 3,
    },
    {
      label: "a slate longer than the cap: the cap wins",
      cap: 2,
      games: [SUBMITTABLE, SUBMITTABLE, SUBMITTABLE],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 2,
    },
    {
      label: "a locked game is forgone, not required (ADR-0018 decision 2)",
      cap: 5,
      games: [{ ...SUBMITTABLE, locked: true }, SUBMITTABLE, SUBMITTABLE],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 2,
    },
    {
      label: "a cancelled game never raises the requirement",
      cap: 5,
      games: [{ ...SUBMITTABLE, pickable: false }, SUBMITTABLE],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 1,
    },
    // The lockout this filter exists to prevent: the write path refuses a pick
    // on an unpriced game with `spread_unavailable`, so counting it would demand
    // a pick that same request then rejects — and the member could never submit
    // the week at all.
    {
      label: "an ATS game with no line yet is not part of the required set",
      cap: 5,
      games: [{ ...SUBMITTABLE, spread: null }, SUBMITTABLE, SUBMITTABLE],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 2,
    },
    // Straight-up has no spread dependency at all, so the same slate asks for
    // every game. The filter must not leak across pick types.
    {
      label: "the same unpriced game is required in a straight-up league",
      cap: 5,
      games: [{ ...SUBMITTABLE, spread: null }, SUBMITTABLE, SUBMITTABLE],
      pickType: PICK_TYPE.STRAIGHT_UP,
      expected: 3,
    },
    {
      label: "a spread of 0 is a real line, not a missing one",
      cap: 5,
      games: [{ ...SUBMITTABLE, spread: 0 }, SUBMITTABLE],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 2,
    },
    // Both exclusions hit one row. A game must be subtracted once, not twice —
    // an `unlocked + priced` count computed as two independent subtractions
    // would undercount here and re-open the incomplete-set refusal.
    {
      label: "a game that is both locked and unpriced is excluded once, not twice",
      cap: 5,
      games: [{ locked: true, pickable: true, spread: null }, SUBMITTABLE, SUBMITTABLE],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 2,
    },
    {
      label: "an ATS week with no lines posted at all requires nothing yet",
      cap: 5,
      games: [
        { ...SUBMITTABLE, spread: null },
        { ...SUBMITTABLE, spread: null },
      ],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 0,
    },
    {
      label: "the cap still binds once late kickoffs shrink the slate below it",
      cap: 2,
      games: [{ ...SUBMITTABLE, locked: true }, { ...SUBMITTABLE, locked: true }, SUBMITTABLE],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 1,
    },
    {
      label: "a week whose games have all kicked off requires nothing",
      cap: 3,
      games: [
        { ...SUBMITTABLE, locked: true },
        { ...SUBMITTABLE, locked: true },
      ],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 0,
    },
    {
      label: "an empty slate requires nothing",
      cap: 3,
      games: [],
      pickType: PICK_TYPE.AGAINST_THE_SPREAD,
      expected: 0,
    },
  ])("$label", ({ cap, games, pickType, expected }) => {
    expect(requiredPickemPickCount(cap, games, pickType)).toBe(expected);
  });
});
