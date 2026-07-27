import { describe, expect, it } from "vitest";
import { aggregateStandings, rankStandings, type StandingsEntry } from "./standings";

/**
 * Spec §Game Mode 1 — Standings and Tiebreakers is the test plan. The tie cases
 * are the point of this file: the spec exhausts its tiebreakers at the
 * differential and then explicitly leaves members sharing a rank.
 */

function entry(memberId: string, points: number, differential: number): StandingsEntry {
  return { memberId, points, differential };
}

describe("aggregateStandings", () => {
  it("sums points and differential per member", () => {
    const result = aggregateStandings(
      [
        { memberId: "a", points: 1, differential: 7 },
        { memberId: "a", points: 0, differential: -3 },
        { memberId: "b", points: 0.5, differential: 0 },
      ],
      ["a", "b"],
    );

    expect(result).toEqual([
      { memberId: "a", points: 1, differential: 4 },
      { memberId: "b", points: 0.5, differential: 0 },
    ]);
  });

  it("returns a real zero for a member who submitted nothing", () => {
    // Spec §Standings: a week with no submission counts as zero, and one week of
    // participation is enough to appear — so a silent member is still on the board.
    const result = aggregateStandings([{ memberId: "a", points: 1, differential: 7 }], ["a", "b"]);

    expect(result).toContainEqual({ memberId: "b", points: 0, differential: 0 });
  });

  it("returns every member for an empty outcome set", () => {
    expect(aggregateStandings([], ["a", "b"])).toEqual([
      { memberId: "a", points: 0, differential: 0 },
      { memberId: "b", points: 0, differential: 0 },
    ]);
  });

  it("sums half-point pushes exactly", () => {
    const result = aggregateStandings(
      [
        { memberId: "a", points: 0.5, differential: 0 },
        { memberId: "a", points: 0.5, differential: 0 },
        { memberId: "a", points: 0.5, differential: 0 },
      ],
      ["a"],
    );

    expect(result[0]?.points).toBe(1.5);
  });

  it("throws when an outcome names a member outside the roster", () => {
    expect(() =>
      aggregateStandings([{ memberId: "ghost", points: 1, differential: 0 }], ["a"]),
    ).toThrow(/ghost/);
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

  it("handles an empty board and a single member", () => {
    expect(rankStandings([])).toEqual([]);
    expect(rankStandings([entry("a", 0, 0)])).toEqual([
      { memberId: "a", points: 0, differential: 0, rank: 1 },
    ]);
  });

  it("does not mutate its input", () => {
    const entries = [entry("a", 1, 0), entry("b", 2, 0)];
    const snapshot = JSON.stringify(entries);

    rankStandings(entries);

    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it("is a pure derivation — ranking twice is identical", () => {
    const entries = [entry("a", 3, 1), entry("b", 3, 1), entry("c", 0, -5)];

    expect(rankStandings(entries)).toEqual(rankStandings(entries));
  });
});
