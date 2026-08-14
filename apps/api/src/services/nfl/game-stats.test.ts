import { describe, expect, it } from "vitest";
import {
  resolveNflGameStatContext,
  resolveNflTeamSeasonStatsOverrides,
  scoringRank,
} from "./game-stats";
import type { NflTeamGameContext } from "@picksleagues/schemas";

type StatsRow = Parameters<typeof scoringRank>[0][number];

/** A stats row with only the fields the ranking reads meaningfully populated. */
function row(teamId: string, games: number, pointsFor: number, pointsAgainst: number): StatsRow {
  return {
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
    expect(scoringRank(rows, "A", "offense", 4)).toBe(1);
    // B and C both average 25 — competition ranking shares the rank.
    expect(scoringRank(rows, "B", "offense", 4)).toBe(2);
    expect(scoringRank(rows, "C", "offense", 4)).toBe(2);
  });

  it("ranks defense by points allowed per game, ascending", () => {
    expect(scoringRank(rows, "A", "defense", 4)).toBe(1);
    expect(scoringRank(rows, "B", "defense", 4)).toBe(2);
    expect(scoringRank(rows, "C", "defense", 4)).toBe(3);
  });

  it("is null for a team with no games — unplayed teams neither rank nor dilute the pool", () => {
    expect(scoringRank(rows, "D", "offense", 4)).toBeNull();
    expect(scoringRank(rows, "missing", "offense", 4)).toBeNull();
  });

  it("is null while fewer than half the league has played — '1st' of a two-team pool is not a league rank", () => {
    const earlyWeek = [
      row("A", 1, 30, 10),
      row("B", 1, 20, 30),
      row("C", 0, 0, 0),
      row("D", 0, 0, 0),
      row("E", 0, 0, 0),
    ];
    expect(scoringRank(earlyWeek, "A", "offense", 5)).toBeNull();
  });
});

describe("scoringRank league-size denominator", () => {
  it("a partially ingested pool cannot pass its own shrunken bar", () => {
    // Only 2 of a 32-team league have rows at all — both played, but "1st"
    // of that pool is not a league rank.
    const partial = [row("A", 1, 30, 10), row("B", 1, 20, 30)];
    expect(scoringRank(partial, "A", "offense", 32)).toBeNull();
    // The same pool IS the whole league in a 2-team world (integration seeds).
    expect(scoringRank(partial, "A", "offense", 2)).toBe(1);
  });
});

describe("resolveNflTeamSeasonStatsOverrides", () => {
  const dbRow = {
    id: "row-1",
    teamId: "team-1",
    seasonYear: 2026,
    wins: 4,
    losses: 2,
    ties: 0,
    homeWins: 2,
    homeLosses: 1,
    homeTies: 0,
    roadWins: 2,
    roadLosses: 1,
    roadTies: 0,
    streak: 2,
    pointsFor: 150,
    pointsAgainst: 120,
    overrideWins: null,
    overrideLosses: null,
    overrideTies: null,
    overrideHomeWins: null,
    overrideHomeLosses: null,
    overrideHomeTies: null,
    overrideRoadWins: null,
    overrideRoadLosses: null,
    overrideRoadTies: null,
    overrideStreak: null,
    overridePointsFor: null,
    overridePointsAgainst: null,
    overriddenBy: null,
    overriddenAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  it("serves provider facts where no override is set", () => {
    const resolved = resolveNflTeamSeasonStatsOverrides(dbRow);
    expect(resolved.wins).toBe(4);
    expect(resolved.pointsAgainst).toBe(120);
  });

  it("an override wins field by field, leaving unset fields on provider truth", () => {
    const resolved = resolveNflTeamSeasonStatsOverrides({
      ...dbRow,
      overrideWins: 5,
      overrideStreak: -1,
    });
    expect(resolved.wins).toBe(5);
    expect(resolved.streak).toBe(-1);
    // Untouched fields keep tracking the provider.
    expect(resolved.losses).toBe(2);
    expect(resolved.pointsFor).toBe(150);
  });

  it("an override of 0 wins — falsy is not absent", () => {
    const resolved = resolveNflTeamSeasonStatsOverrides({ ...dbRow, overrideStreak: 0 });
    expect(resolved.streak).toBe(0);
  });
});

describe("resolveNflGameStatContext", () => {
  const side = (fpi: number | null): NflTeamGameContext => ({
    injuries: [{ athleteName: "A. Player", position: "QB", status: "Out", injuryType: "Ankle" }],
    fpiWinPct: fpi,
    atsSummary: "3-2",
    lastFive: [],
  });
  const payload = { home: side(60), away: side(40) };

  it("serves the provider payload untouched when there is no override", () => {
    expect(resolveNflGameStatContext(payload, null)).toEqual(payload);
  });

  it("a present field replaces whole; absent fields fall through per side", () => {
    const resolved = resolveNflGameStatContext(payload, {
      home: { injuries: [] },
    });
    // The overridden list replaces the provider's — masking a wrong report.
    expect(resolved.home.injuries).toEqual([]);
    // Sparse: the same side's other fields keep tracking the provider…
    expect(resolved.home.fpiWinPct).toBe(60);
    expect(resolved.home.atsSummary).toBe("3-2");
    // …and the other side is untouched entirely.
    expect(resolved.away).toEqual(payload.away);
  });
});
