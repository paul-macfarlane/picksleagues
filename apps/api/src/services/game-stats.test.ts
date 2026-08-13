import { describe, expect, it } from "vitest";
import { scoringRank } from "./game-stats";

type StatsRow = Parameters<typeof scoringRank>[0][number];

/** A stats row with only the fields the ranking reads meaningfully populated. */
function row(teamId: string, games: number, pointsFor: number, pointsAgainst: number): StatsRow {
  return {
    id: `${teamId}-row`,
    teamId,
    seasonYear: 2026,
    wins: games,
    losses: 0,
    ties: 0,
    homeWins: 0,
    homeLosses: 0,
    homeTies: 0,
    roadWins: 0,
    roadLosses: 0,
    roadTies: 0,
    streak: 0,
    pointsFor,
    pointsAgainst,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("scoringRank", () => {
  const rows = [
    // Per-game: A 30/10, B 25/20, C 25/30, D unplayed.
    row("A", 2, 60, 20),
    row("B", 2, 50, 40),
    row("C", 1, 25, 30),
    row("D", 0, 0, 0),
  ];

  it("ranks offense by points scored per game, descending", () => {
    expect(scoringRank(rows, "A", "offense")).toBe(1);
    // B and C both average 25 — competition ranking shares the rank.
    expect(scoringRank(rows, "B", "offense")).toBe(2);
    expect(scoringRank(rows, "C", "offense")).toBe(2);
  });

  it("ranks defense by points allowed per game, ascending", () => {
    expect(scoringRank(rows, "A", "defense")).toBe(1);
    expect(scoringRank(rows, "B", "defense")).toBe(2);
    expect(scoringRank(rows, "C", "defense")).toBe(3);
  });

  it("is null for a team with no games — unplayed teams neither rank nor dilute the pool", () => {
    expect(scoringRank(rows, "D", "offense")).toBeNull();
    expect(scoringRank(rows, "missing", "offense")).toBeNull();
  });

  it("is null while fewer than half the league has played — '1st' of a two-team pool is not a league rank", () => {
    const earlyWeek = [
      row("A", 1, 30, 10),
      row("B", 1, 20, 30),
      row("C", 0, 0, 0),
      row("D", 0, 0, 0),
      row("E", 0, 0, 0),
    ];
    expect(scoringRank(earlyWeek, "A", "offense")).toBeNull();
  });
});
