import { describe, expect, it } from "vitest";

import type { Phase, Season } from "@/lib/db/schema/sports";

import {
  getLeagueSeasonState,
  hasLeagueStartLockPassed,
  isLeagueInSeason,
  leagueActivationTime,
  seasonFormatToSeasonTypes,
  selectCurrentSeason,
  selectLeagueStartPhase,
} from "./leagues";

function phase(
  overrides: Pick<Phase, "startDate" | "endDate" | "seasonType"> &
    Partial<Phase>,
): Phase {
  return {
    id:
      overrides.id ??
      `phase-${overrides.seasonType}-${overrides.startDate.toISOString()}`,
    seasonId: overrides.seasonId ?? "season-x",
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

describe("getLeagueSeasonState", () => {
  const regularWeek1 = phase({
    seasonType: "regular",
    startDate: new Date("2025-09-07T00:00:00Z"),
    endDate: new Date("2025-09-14T00:00:00Z"),
  });
  const regularWeek18 = phase({
    seasonType: "regular",
    startDate: new Date("2026-01-04T00:00:00Z"),
    endDate: new Date("2026-01-11T00:00:00Z"),
  });
  const wildCard = phase({
    seasonType: "postseason",
    startDate: new Date("2026-01-11T00:00:00Z"),
    endDate: new Date("2026-01-18T00:00:00Z"),
  });
  const superBowl = phase({
    seasonType: "postseason",
    startDate: new Date("2026-02-08T00:00:00Z"),
    endDate: new Date("2026-02-15T00:00:00Z"),
  });

  it("returns 'upcoming' before any relevant phase has started", () => {
    const now = new Date("2025-08-01T00:00:00Z");
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        "regular_season",
        now,
      ),
    ).toBe("upcoming");
  });

  it("returns 'in_progress' while any relevant phase contains now", () => {
    const now = new Date("2025-09-10T12:00:00Z");
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        "regular_season",
        now,
      ),
    ).toBe("in_progress");
  });

  it("returns 'in_progress' between format-relevant phases (gap inside the season)", () => {
    const now = new Date("2025-10-01T00:00:00Z");
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18],
        "regular_season",
        now,
      ),
    ).toBe("in_progress");
  });

  it("returns 'complete' once every relevant phase has ended", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        "full_season",
        now,
      ),
    ).toBe("complete");
  });

  it("ignores phases outside the league's format", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    // In postseason window but league is regular_season only — regular season
    // ended before wildcard started.
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        "regular_season",
        now,
      ),
    ).toBe("complete");
    // And a postseason-only league treats the same moment as in_progress.
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        "postseason",
        now,
      ),
    ).toBe("in_progress");
  });

  it("returns 'upcoming' when no phases of the format are synced yet", () => {
    const now = new Date("2025-09-10T12:00:00Z");
    expect(getLeagueSeasonState([regularWeek1], "postseason", now)).toBe(
      "upcoming",
    );
  });
});

describe("leagueActivationTime", () => {
  it("returns the season start date for leagues created pre-season", () => {
    const createdAt = new Date("2025-05-01T00:00:00Z");
    const seasonStart = new Date("2025-09-01T00:00:00Z");
    expect(leagueActivationTime(createdAt, seasonStart)).toEqual(seasonStart);
  });

  it("returns createdAt for leagues created mid-season", () => {
    const createdAt = new Date("2025-10-15T00:00:00Z");
    const seasonStart = new Date("2025-09-01T00:00:00Z");
    expect(leagueActivationTime(createdAt, seasonStart)).toEqual(createdAt);
  });
});

describe("selectLeagueStartPhase", () => {
  const week1 = phase({
    seasonType: "regular",
    startDate: new Date("2025-09-07T00:00:00Z"),
    endDate: new Date("2025-09-14T00:00:00Z"),
    pickLockTime: new Date("2025-09-07T17:00:00Z"),
    weekNumber: 1,
  });
  const week2 = phase({
    seasonType: "regular",
    startDate: new Date("2025-09-14T00:00:00Z"),
    endDate: new Date("2025-09-21T00:00:00Z"),
    pickLockTime: new Date("2025-09-14T17:00:00Z"),
    weekNumber: 2,
  });
  const wildCard = phase({
    seasonType: "postseason",
    startDate: new Date("2026-01-11T00:00:00Z"),
    endDate: new Date("2026-01-18T00:00:00Z"),
    pickLockTime: new Date("2026-01-10T18:00:00Z"),
    weekNumber: 19,
  });

  it("picks Week 1 for pre-season activation", () => {
    const activation = new Date("2025-05-01T00:00:00Z");
    expect(
      selectLeagueStartPhase(
        [week1, week2, wildCard],
        "regular_season",
        activation,
      ),
    ).toEqual(week1);
  });

  it("picks the next upcoming week for a mid-Week-1 activation", () => {
    // Activation is AFTER Week 1's pick lock → Week 1 is disqualified.
    const activation = new Date("2025-09-08T00:00:00Z");
    expect(
      selectLeagueStartPhase(
        [week1, week2, wildCard],
        "regular_season",
        activation,
      ),
    ).toEqual(week2);
  });

  it("ignores phases outside the league's format", () => {
    const activation = new Date("2025-05-01T00:00:00Z");
    expect(
      selectLeagueStartPhase(
        [week1, week2, wildCard],
        "postseason",
        activation,
      ),
    ).toEqual(wildCard);
  });

  it("returns null when every format-relevant pick lock has already fired", () => {
    const activation = new Date("2026-06-01T00:00:00Z");
    expect(
      selectLeagueStartPhase(
        [week1, week2, wildCard],
        "regular_season",
        activation,
      ),
    ).toBeNull();
  });
});

describe("hasLeagueStartLockPassed", () => {
  const week1 = phase({
    seasonType: "regular",
    startDate: new Date("2025-09-07T00:00:00Z"),
    endDate: new Date("2025-09-14T00:00:00Z"),
    pickLockTime: new Date("2025-09-07T17:00:00Z"),
  });
  const week2 = phase({
    seasonType: "regular",
    startDate: new Date("2025-09-14T00:00:00Z"),
    endDate: new Date("2025-09-21T00:00:00Z"),
    pickLockTime: new Date("2025-09-14T17:00:00Z"),
    weekNumber: 2,
  });

  it("returns false before the start phase's pick lock", () => {
    const activation = new Date("2025-05-01T00:00:00Z");
    const now = new Date("2025-09-07T10:00:00Z"); // pre-lock
    expect(
      hasLeagueStartLockPassed(
        [week1, week2],
        "regular_season",
        activation,
        now,
      ),
    ).toBe(false);
  });

  it("returns true at the exact pick lock time", () => {
    const activation = new Date("2025-05-01T00:00:00Z");
    const now = new Date("2025-09-07T17:00:00Z"); // exactly at lock
    expect(
      hasLeagueStartLockPassed(
        [week1, week2],
        "regular_season",
        activation,
        now,
      ),
    ).toBe(true);
  });

  it("uses Week 2 as the start phase when activation is after Week 1's lock", () => {
    const activation = new Date("2025-09-08T00:00:00Z"); // mid-Week-2 prep
    // Before Week 2's lock, so not locked.
    expect(
      hasLeagueStartLockPassed(
        [week1, week2],
        "regular_season",
        activation,
        new Date("2025-09-14T10:00:00Z"),
      ),
    ).toBe(false);
    // After Week 2's lock, locked.
    expect(
      hasLeagueStartLockPassed(
        [week1, week2],
        "regular_season",
        activation,
        new Date("2025-09-15T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("returns true when no eligible start phase remains", () => {
    const activation = new Date("2026-06-01T00:00:00Z");
    const now = new Date("2026-06-02T00:00:00Z");
    expect(
      hasLeagueStartLockPassed(
        [week1, week2],
        "regular_season",
        activation,
        now,
      ),
    ).toBe(true);
  });
});
