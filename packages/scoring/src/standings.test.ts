import { describe, expect, it } from "vitest";
import { PICK_OUTCOME, type PickOutcome } from "@picksleagues/schemas";
import {
  aggregateStandings,
  rankStandings,
  type OutcomeCounts,
  type ScoredOutcome,
  type StandingsEntry,
} from "./standings";

/**
 * Spec §Game Mode 1 — Standings is the test plan. The tie cases are the point of
 * this file: points are the whole ordering, and members level on them share a
 * rank with nothing drawn between them (ADR-0018).
 */

function entry(
  memberId: string,
  points: number,
  counts: Partial<OutcomeCounts> = {},
): StandingsEntry {
  return { memberId, points, wins: 0, losses: 0, pushes: 0, ...counts };
}

function scored(memberId: string, outcome: PickOutcome, points: number): ScoredOutcome {
  return { memberId, outcome, points };
}

describe("aggregateStandings", () => {
  it("sums points per member", () => {
    const result = aggregateStandings(
      [
        scored("a", PICK_OUTCOME.CORRECT, 1),
        scored("a", PICK_OUTCOME.INCORRECT, 0),
        scored("b", PICK_OUTCOME.PUSH, 0.5),
      ],
      ["a", "b"],
    );

    expect(result).toEqual([
      { memberId: "a", points: 1, wins: 1, losses: 1, pushes: 0 },
      { memberId: "b", points: 0.5, wins: 0, losses: 0, pushes: 1 },
    ]);
  });

  it("tallies a member holding all three outcomes", () => {
    const result = aggregateStandings(
      [
        scored("a", PICK_OUTCOME.CORRECT, 1),
        scored("a", PICK_OUTCOME.CORRECT, 1),
        scored("a", PICK_OUTCOME.INCORRECT, 0),
        scored("a", PICK_OUTCOME.PUSH, 0.5),
        scored("a", PICK_OUTCOME.PUSH, 0.5),
      ],
      ["a"],
    );

    expect(result[0]).toEqual({
      memberId: "a",
      points: 3,
      wins: 2,
      losses: 1,
      pushes: 2,
    });
  });

  it("returns a real zero for a member who submitted nothing", () => {
    // Spec §Standings: a week with no submission counts as zero, and one week of
    // participation is enough to appear — so a silent member is still on the board,
    // with an empty 0-0-0 record rather than a missing one.
    const result = aggregateStandings([scored("a", PICK_OUTCOME.CORRECT, 1)], ["a", "b"]);

    expect(result).toContainEqual({
      memberId: "b",
      points: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
    });
  });

  it("returns every member for an empty outcome set", () => {
    expect(aggregateStandings([], ["a", "b"])).toEqual([
      { memberId: "a", points: 0, wins: 0, losses: 0, pushes: 0 },
      { memberId: "b", points: 0, wins: 0, losses: 0, pushes: 0 },
    ]);
  });

  it("sums half-point pushes exactly", () => {
    const result = aggregateStandings(
      [
        scored("a", PICK_OUTCOME.PUSH, 0.5),
        scored("a", PICK_OUTCOME.PUSH, 0.5),
        scored("a", PICK_OUTCOME.PUSH, 0.5),
      ],
      ["a"],
    );

    expect(result[0]?.points).toBe(1.5);
    expect(result[0]?.pushes).toBe(3);
  });

  it("counts a push by its outcome, not by the points it carries", () => {
    // The record keys off `outcome` alone, which is what lets a mode that scores
    // a push at something other than half a point still call it a push.
    const result = aggregateStandings([scored("a", PICK_OUTCOME.PUSH, 0)], ["a"]);

    expect(result[0]).toMatchObject({ wins: 0, losses: 0, pushes: 1 });
  });

  it("throws when an outcome names a member outside the roster", () => {
    expect(() => aggregateStandings([scored("ghost", PICK_OUTCOME.CORRECT, 1)], ["a"])).toThrow(
      /ghost/,
    );
  });
});

describe("rankStandings", () => {
  it("ranks by points descending", () => {
    const ranked = rankStandings([entry("a", 2), entry("b", 5), entry("c", 3)]);

    expect(ranked.map((r) => [r.memberId, r.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
  });

  it("shares a rank when points are level — nothing breaks the tie", () => {
    const ranked = rankStandings([entry("a", 3), entry("b", 3), entry("c", 1)]);

    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("skips ranks after a shared one — competition ranking, not dense", () => {
    const ranked = rankStandings([entry("a", 5), entry("b", 5), entry("c", 5), entry("d", 1)]);

    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1, 4]);
  });

  it("ranks identical pick sets completely level", () => {
    // Spec §Edge Cases: identical pick sets tie on points and share the rank.
    const ranked = rankStandings([entry("a", 4), entry("b", 4)]);

    expect(ranked.every((r) => r.rank === 1)).toBe(true);
  });

  it("separates a half point — the smallest gap the scoring can produce", () => {
    const ranked = rankStandings([entry("a", 2), entry("b", 2.5)]);

    expect(ranked.map((r) => [r.memberId, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it("ignores the W/L/P counts when ordering — a better record breaks no tie", () => {
    // Spec §Standings — Ties: points are the whole ordering, so 4-0-0 and 2-0-4
    // landing on the same points still share a rank, in input order.
    const ranked = rankStandings([
      entry("a", 4, { wins: 2, pushes: 4 }),
      entry("b", 4, { wins: 4 }),
    ]);

    expect(ranked.map((r) => [r.memberId, r.rank])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("carries the counts through untouched", () => {
    const ranked = rankStandings([entry("a", 3, { wins: 3, losses: 2, pushes: 1 })]);

    expect(ranked[0]).toMatchObject({ wins: 3, losses: 2, pushes: 1, rank: 1 });
  });

  it("handles an empty board and a single member", () => {
    expect(rankStandings([])).toEqual([]);
    expect(rankStandings([entry("a", 0)])).toEqual([
      { memberId: "a", points: 0, wins: 0, losses: 0, pushes: 0, rank: 1 },
    ]);
  });

  it("does not mutate its input", () => {
    const entries = [entry("a", 1), entry("b", 2)];
    const snapshot = JSON.stringify(entries);

    rankStandings(entries);

    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it("is a pure derivation — ranking twice is identical", () => {
    const entries = [
      entry("a", 3, { wins: 3, losses: 1 }),
      entry("b", 3, { wins: 3, losses: 1 }),
      entry("c", 0, { losses: 4 }),
    ];

    expect(rankStandings(entries)).toEqual(rankStandings(entries));
  });
});
