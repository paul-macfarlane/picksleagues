import { describe, expect, it } from "vitest";

import type { Season } from "@/lib/db/schema/sports";

import {
  isLeagueInSeason,
  seasonFormatToSeasonTypes,
  selectCurrentSeason,
} from "./leagues";

function season(overrides: Partial<Season> & Pick<Season, "year">): Season {
  return {
    id: `season-${overrides.year}`,
    sportsLeagueId: "nfl",
    year: overrides.year,
    startDate:
      overrides.startDate ?? new Date(`${overrides.year}-09-01T00:00:00Z`),
    endDate:
      overrides.endDate ?? new Date(`${overrides.year + 1}-02-28T00:00:00Z`),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("seasonFormatToSeasonTypes", () => {
  it("maps regular_season to [regular]", () => {
    expect(seasonFormatToSeasonTypes("regular_season")).toEqual(["regular"]);
  });

  it("maps postseason to [postseason]", () => {
    expect(seasonFormatToSeasonTypes("postseason")).toEqual(["postseason"]);
  });

  it("maps full_season to [regular, postseason]", () => {
    expect(seasonFormatToSeasonTypes("full_season")).toEqual([
      "regular",
      "postseason",
    ]);
  });
});

describe("selectCurrentSeason", () => {
  it("returns null for an empty list", () => {
    expect(selectCurrentSeason([], new Date("2026-04-01"))).toBeNull();
  });

  it("returns the season whose date range contains now", () => {
    const past = season({ year: 2024 });
    const current = season({
      year: 2025,
      startDate: new Date("2025-09-01"),
      endDate: new Date("2026-02-28"),
    });
    const future = season({
      year: 2026,
      startDate: new Date("2026-09-01"),
      endDate: new Date("2027-02-28"),
    });
    const now = new Date("2025-12-15");
    expect(selectCurrentSeason([past, current, future], now)).toEqual(current);
  });

  it("returns the nearest upcoming season when none is active", () => {
    const past = season({
      year: 2024,
      startDate: new Date("2024-09-01"),
      endDate: new Date("2025-02-28"),
    });
    const near = season({
      year: 2025,
      startDate: new Date("2025-09-01"),
      endDate: new Date("2026-02-28"),
    });
    const far = season({
      year: 2026,
      startDate: new Date("2026-09-01"),
      endDate: new Date("2027-02-28"),
    });
    const now = new Date("2025-06-15");
    expect(selectCurrentSeason([past, near, far], now)).toEqual(near);
  });

  it("falls back to the most recent season when none are active or upcoming", () => {
    const older = season({ year: 2023 });
    const newer = season({ year: 2024 });
    const now = new Date("2027-06-01");
    expect(selectCurrentSeason([older, newer], now)).toEqual(newer);
  });
});

describe("isLeagueInSeason", () => {
  const regularPhase = { seasonType: "regular" as const };
  const postPhase = { seasonType: "postseason" as const };

  it("returns true when an active phase matches a format that includes its type", () => {
    expect(isLeagueInSeason([regularPhase], "regular_season")).toBe(true);
    expect(isLeagueInSeason([regularPhase], "full_season")).toBe(true);
    expect(isLeagueInSeason([postPhase], "postseason")).toBe(true);
    expect(isLeagueInSeason([postPhase], "full_season")).toBe(true);
  });

  it("returns false when the active phase type is not in the format", () => {
    expect(isLeagueInSeason([postPhase], "regular_season")).toBe(false);
    expect(isLeagueInSeason([regularPhase], "postseason")).toBe(false);
  });

  it("returns false when there are no active phases", () => {
    expect(isLeagueInSeason([], "full_season")).toBe(false);
  });
});
