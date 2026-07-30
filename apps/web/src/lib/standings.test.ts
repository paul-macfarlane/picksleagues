import { describe, expect, it } from "vitest";
import { rankLabel, sharedRankCounts } from "./standings";

/**
 * Spec §Tiebreakers: members level on points *and* differential share a rank,
 * and the board must say so rather than silently renumbering them 1, 2, 3.
 */
describe("rankLabel", () => {
  it("renders a rank held by one member plainly", () => {
    expect(rankLabel(1, new Map([[1, 1]]))).toBe("1");
  });

  it("marks a shared rank so a tie is visible", () => {
    expect(rankLabel(1, new Map([[1, 2]]))).toBe("T-1");
  });

  it("marks a three-way tie the same way", () => {
    expect(rankLabel(2, new Map([[2, 3]]))).toBe("T-2");
  });

  it("leaves the rank after a shared one plain — competition ranking skips", () => {
    // Two tied at 1 means the next member is rank 3, held alone.
    const counts = new Map([
      [1, 2],
      [3, 1],
    ]);
    expect(rankLabel(1, counts)).toBe("T-1");
    expect(rankLabel(3, counts)).toBe("3");
  });

  it("treats an uncounted rank as unshared rather than throwing", () => {
    expect(rankLabel(4, new Map())).toBe("4");
  });
});

describe("sharedRankCounts", () => {
  it("counts how many members hold each rank", () => {
    expect(sharedRankCounts([{ rank: 1 }, { rank: 1 }, { rank: 3 }])).toEqual(
      new Map([
        [1, 2],
        [3, 1],
      ]),
    );
  });

  it("returns an empty map for an unsettled board", () => {
    expect(sharedRankCounts([])).toEqual(new Map());
  });

  // The two halves are one rule: counts built here must be readable by
  // rankLabel without either side re-deriving what "shared" means.
  it("feeds rankLabel directly", () => {
    const counts = sharedRankCounts([{ rank: 1 }, { rank: 1 }, { rank: 3 }]);
    expect(rankLabel(1, counts)).toBe("T-1");
    expect(rankLabel(3, counts)).toBe("3");
  });
});
