import { describe, expect, it } from "vitest";

import type { Phase, Season } from "@/lib/db/schema/sports";

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

function phase(
  overrides: Partial<Phase> &
    Pick<Phase, "startDate" | "endDate" | "seasonType">,
): Phase {
  return {
    id: overrides.id ?? "phase-1",
    seasonId: overrides.seasonId ?? "season-2025",
    seasonType: overrides.seasonType,
    weekNumber: overrides.weekNumber ?? 1,
    label: overrides.label ?? "Week 1",
    startDate: overrides.startDate,
    endDate: overrides.endDate,
    pickLockTime: overrides.pickLockTime ?? overrides.startDate,
    lockedAt: overrides.lockedAt ?? null,
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
  const regularPhase = phase({
    id: "p-reg",
    seasonType: "regular",
    startDate: new Date("2025-09-02T06:00:00Z"),
    endDate: new Date("2025-09-09T06:00:00Z"),
  });
  const postPhase = phase({
    id: "p-post",
    seasonType: "postseason",
    startDate: new Date("2026-01-13T06:00:00Z"),
    endDate: new Date("2026-01-20T06:00:00Z"),
  });

  it("returns true when now is inside a phase that matches the format", () => {
    const now = new Date("2025-09-05T12:00:00Z");
    expect(
      isLeagueInSeason([regularPhase, postPhase], "regular_season", now),
    ).toBe(true);
    expect(
      isLeagueInSeason([regularPhase, postPhase], "full_season", now),
    ).toBe(true);
  });

  it("returns false when now is inside a phase whose type is not in the format", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    expect(
      isLeagueInSeason([regularPhase, postPhase], "regular_season", now),
    ).toBe(false);
    expect(isLeagueInSeason([regularPhase, postPhase], "postseason", now)).toBe(
      true,
    );
  });

  it("returns false when now is outside every phase window", () => {
    const now = new Date("2025-07-01T00:00:00Z");
    expect(
      isLeagueInSeason([regularPhase, postPhase], "full_season", now),
    ).toBe(false);
  });

  it("treats the phase end as exclusive", () => {
    const now = regularPhase.endDate;
    expect(isLeagueInSeason([regularPhase], "regular_season", now)).toBe(false);
  });

  it("treats the phase start as inclusive", () => {
    const now = regularPhase.startDate;
    expect(isLeagueInSeason([regularPhase], "regular_season", now)).toBe(true);
  });
});
