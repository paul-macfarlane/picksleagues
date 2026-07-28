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
 * Spec §Game Mode 1 — Standings and Tiebreakers is the test plan. The tie cases
 * are the point of this file: the spec exhausts its tiebreakers at the
 * differential and then explicitly leaves members sharing a rank.
 */

function entry(
  memberId: string,
  points: number,
  differential: number,
  counts: Partial<OutcomeCounts> = {},
): StandingsEntry {
  return { memberId, points, differential, wins: 0, losses: 0, pushes: 0, ...counts };
}

function scored(
  memberId: string,
  outcome: PickOutcome,
  points: number,
  differential: number,
): ScoredOutcome {
  return { memberId, outcome, points, differential };
}

describe("aggregateStandings", () => {
  it("sums points and differential per member", () => {
    const result = aggregateStandings(
      [
        scored("a", PICK_OUTCOME.CORRECT, 1, 7),
        scored("a", PICK_OUTCOME.INCORRECT, 0, -3),
        scored("b", PICK_OUTCOME.PUSH, 0.5, 0),
      ],
      ["a", "b"],
    );

    expect(result).toEqual([
      { memberId: "a", points: 1, differential: 4, wins: 1, losses: 1, pushes: 0 },
      { memberId: "b", points: 0.5, differential: 0, wins: 0, losses: 0, pushes: 1 },
    ]);
  });

  it("tallies a member holding all three outcomes", () => {
    const result = aggregateStandings(
      [
        scored("a", PICK_OUTCOME.CORRECT, 1, 10),
        scored("a", PICK_OUTCOME.CORRECT, 1, 3),
        scored("a", PICK_OUTCOME.INCORRECT, 0, -6),
        scored("a", PICK_OUTCOME.PUSH, 0.5, 0),
        scored("a", PICK_OUTCOME.PUSH, 0.5, 0),
      ],
      ["a"],
    );

    expect(result[0]).toEqual({
      memberId: "a",
      points: 3,
      differential: 7,
      wins: 2,
      losses: 1,
      pushes: 2,
    });
  });

  it("returns a real zero for a member who submitted nothing", () => {
    // Spec §Standings: a week with no submission counts as zero, and one week of
    // participation is enough to appear — so a silent member is still on the board,
    // with an empty 0-0-0 record rather than a missing one.
    const result = aggregateStandings([scored("a", PICK_OUTCOME.CORRECT, 1, 7)], ["a", "b"]);

    expect(result).toContainEqual({
      memberId: "b",
      points: 0,
      differential: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
    });
  });

  it("returns every member for an empty outcome set", () => {
    expect(aggregateStandings([], ["a", "b"])).toEqual([
      { memberId: "a", points: 0, differential: 0, wins: 0, losses: 0, pushes: 0 },
      { memberId: "b", points: 0, differential: 0, wins: 0, losses: 0, pushes: 0 },
    ]);
  });

  it("sums half-point pushes exactly", () => {
    const result = aggregateStandings(
      [
        scored("a", PICK_OUTCOME.PUSH, 0.5, 0),
        scored("a", PICK_OUTCOME.PUSH, 0.5, 0),
        scored("a", PICK_OUTCOME.PUSH, 0.5, 0),
      ],
      ["a"],
    );

    expect(result[0]?.points).toBe(1.5);
    expect(result[0]?.pushes).toBe(3);
  });

  it("counts a zero-point push as a push, not a loss", () => {
    // Push/Tie Resolution can score a push at 0 points (spec §Push/Tie
    // Resolution); the record still has to call it a push.
    const result = aggregateStandings([scored("a", PICK_OUTCOME.PUSH, 0, 0)], ["a"]);

    expect(result[0]).toMatchObject({ wins: 0, losses: 0, pushes: 1 });
  });

  it("throws when an outcome names a member outside the roster", () => {
    expect(() => aggregateStandings([scored("ghost", PICK_OUTCOME.CORRECT, 1, 0)], ["a"])).toThrow(
      /ghost/,
    );
  });
});

describe("rankStandings", () => {
  it("ranks by points descending", () => {
    const ranked = rankStandings([entry("a", 2, 0), entry("b", 5, 0), entry("c", 3, 0)]);

    expect(ranked.map((r) => [r.memberId, r.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
  });

  it("breaks a points tie on cumulative differential", () => {
    const ranked = rankStandings([entry("a", 3, 4), entry("b", 3, 21), entry("c", 3, -6)]);

    expect(ranked.map((r) => [r.memberId, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
  });

  it("shares a rank when points AND differential are both level", () => {
    const ranked = rankStandings([entry("a", 3, 10), entry("b", 3, 10), entry("c", 1, 0)]);

    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("skips ranks after a shared one — competition ranking, not dense", () => {
    const ranked = rankStandings([
      entry("a", 5, 0),
      entry("b", 5, 0),
      entry("c", 5, 0),
      entry("d", 1, 0),
    ]);

    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1, 4]);
  });

  it("ranks identical pick sets completely level", () => {
    // Spec §Edge Cases: identical pick sets tie on points and differential.
    const ranked = rankStandings([entry("a", 4, 12), entry("b", 4, 12)]);

    expect(ranked.every((r) => r.rank === 1)).toBe(true);
  });

  it("separates a negative differential from a positive one at equal points", () => {
    const ranked = rankStandings([entry("a", 2, -1), entry("b", 2, 1)]);

    expect(ranked.map((r) => [r.memberId, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it("ignores the W/L/P counts when ordering — a better record breaks no tie", () => {
    // Spec §Tiebreakers stops at the differential: 4-0-0 and 2-0-4 landing on
    // the same points and differential still share a rank, in input order.
    const ranked = rankStandings([
      entry("a", 4, 6, { wins: 2, pushes: 4 }),
      entry("b", 4, 6, { wins: 4 }),
    ]);

    expect(ranked.map((r) => [r.memberId, r.rank])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("carries the counts through untouched", () => {
    const ranked = rankStandings([entry("a", 3, 5, { wins: 3, losses: 2, pushes: 1 })]);

    expect(ranked[0]).toMatchObject({ wins: 3, losses: 2, pushes: 1, rank: 1 });
  });

  it("handles an empty board and a single member", () => {
    expect(rankStandings([])).toEqual([]);
    expect(rankStandings([entry("a", 0, 0)])).toEqual([
      { memberId: "a", points: 0, differential: 0, wins: 0, losses: 0, pushes: 0, rank: 1 },
    ]);
  });

  it("does not mutate its input", () => {
    const entries = [entry("a", 1, 0), entry("b", 2, 0)];
    const snapshot = JSON.stringify(entries);

    rankStandings(entries);

    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it("is a pure derivation — ranking twice is identical", () => {
    const entries = [
      entry("a", 3, 1, { wins: 3, losses: 1 }),
      entry("b", 3, 1, { wins: 3, losses: 1 }),
      entry("c", 0, -5, { losses: 4 }),
    ];

    expect(rankStandings(entries)).toEqual(rankStandings(entries));
  });
});
