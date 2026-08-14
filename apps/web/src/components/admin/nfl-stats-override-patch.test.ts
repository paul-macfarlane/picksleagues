import { describe, expect, it } from "vitest";
import type { AdminNflTeamSeasonStats } from "@picksleagues/schemas";
import {
  buildNflStatsOverridePatch,
  isNflStatsOverrideFormDirty,
  nflStatsOverrideFormSeed,
} from "./nfl-stats-override-patch";

/**
 * The boundary under test is "cleared" vs "unchanged" vs "set" (arch D15's
 * three states) — the same contract game-override-patch pins, on the stats
 * shape.
 */

function adminStats(overrides: Partial<AdminNflTeamSeasonStats> = {}): AdminNflTeamSeasonStats {
  return {
    id: "stats-1",
    team: { id: "team-1", abbreviation: "KC", name: "Chiefs" },
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
    effectiveWins: 4,
    effectiveLosses: 2,
    effectiveTies: 0,
    effectiveHomeWins: 2,
    effectiveHomeLosses: 1,
    effectiveHomeTies: 0,
    effectiveRoadWins: 2,
    effectiveRoadLosses: 1,
    effectiveRoadTies: 0,
    effectiveStreak: 2,
    effectivePointsFor: 150,
    effectivePointsAgainst: 120,
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("nflStatsOverrideFormSeed", () => {
  it("seeds from the override layer, never the provider or resolved values", () => {
    const seed = nflStatsOverrideFormSeed(adminStats({ overrideWins: 5 }));
    expect(seed.wins).toBe("5");
    // No override → empty input, not the provider's 2.
    expect(seed.losses).toBe("");
  });
});

describe("buildNflStatsOverridePatch", () => {
  const seed = nflStatsOverrideFormSeed(adminStats());

  it("is unchanged when nothing differs from the seed", () => {
    expect(buildNflStatsOverridePatch(seed, { ...seed })).toEqual({ status: "unchanged" });
    expect(isNflStatsOverrideFormDirty(seed, { ...seed })).toBe(false);
  });

  it("includes only the fields the operator changed", () => {
    const result = buildNflStatsOverridePatch(seed, { ...seed, wins: "5" });
    expect(result).toEqual({ status: "ok", patch: { wins: 5 } });
  });

  it("an emptied field is an explicit clear, not an omission", () => {
    const overridden = nflStatsOverrideFormSeed(adminStats({ overrideWins: 5 }));
    const result = buildNflStatsOverridePatch(overridden, { ...overridden, wins: "" });
    expect(result).toEqual({ status: "ok", patch: { wins: null } });
  });

  it("a non-numeric value is a field error, never read as a clear", () => {
    const result = buildNflStatsOverridePatch(seed, { ...seed, wins: "five" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.fieldErrors.wins).toBeDefined();
    }
  });

  it("range rules come from the schema — a fat-fingered digit is refused", () => {
    const result = buildNflStatsOverridePatch(seed, { ...seed, wins: "400" });
    expect(result.status).toBe("invalid");
  });

  it("streak accepts negative values — a losing streak is signed, not invalid", () => {
    const result = buildNflStatsOverridePatch(seed, { ...seed, streak: "-3" });
    expect(result).toEqual({ status: "ok", patch: { streak: -3 } });
  });
});
