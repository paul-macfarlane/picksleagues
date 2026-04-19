import { describe, expect, it } from "vitest";

import type { Event, Phase, Season } from "@/lib/db/schema/sports";

import {
  formatLeagueRange,
  getLeagueSeasonState,
  hasLeagueStartLockPassed,
  isPhaseInLeagueRange,
  isPhaseLocked,
  isPickLocked,
  isValidLeagueRange,
  phaseLabel,
  selectCurrentSeason,
  selectLeagueCurrentPhase,
  selectLeagueStartPhase,
  type LeagueRange,
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

const regularSeasonRange: LeagueRange = {
  startSeasonType: "regular",
  startWeekNumber: 1,
  endSeasonType: "regular",
  endWeekNumber: 18,
};

const postseasonRange: LeagueRange = {
  startSeasonType: "postseason",
  startWeekNumber: 1,
  endSeasonType: "postseason",
  endWeekNumber: 5,
};

const fullSeasonRange: LeagueRange = {
  startSeasonType: "regular",
  startWeekNumber: 1,
  endSeasonType: "postseason",
  endWeekNumber: 5,
};

describe("isPhaseInLeagueRange", () => {
  it("includes a regular-season phase in the regular-season range", () => {
    expect(
      isPhaseInLeagueRange(
        { seasonType: "regular", weekNumber: 5 },
        regularSeasonRange,
      ),
    ).toBe(true);
  });

  it("excludes a postseason phase from the regular-season range", () => {
    expect(
      isPhaseInLeagueRange(
        { seasonType: "postseason", weekNumber: 2 },
        regularSeasonRange,
      ),
    ).toBe(false);
  });

  it("includes regular and postseason phases in a full-season range", () => {
    expect(
      isPhaseInLeagueRange(
        { seasonType: "regular", weekNumber: 10 },
        fullSeasonRange,
      ),
    ).toBe(true);
    expect(
      isPhaseInLeagueRange(
        { seasonType: "postseason", weekNumber: 2 },
        fullSeasonRange,
      ),
    ).toBe(true);
  });

  it("respects mid-season start weeks", () => {
    const midRange: LeagueRange = {
      startSeasonType: "regular",
      startWeekNumber: 5,
      endSeasonType: "regular",
      endWeekNumber: 18,
    };
    expect(
      isPhaseInLeagueRange({ seasonType: "regular", weekNumber: 4 }, midRange),
    ).toBe(false);
    expect(
      isPhaseInLeagueRange({ seasonType: "regular", weekNumber: 5 }, midRange),
    ).toBe(true);
  });
});

describe("isValidLeagueRange", () => {
  it("accepts start equal to end", () => {
    expect(
      isValidLeagueRange({
        startSeasonType: "regular",
        startWeekNumber: 3,
        endSeasonType: "regular",
        endWeekNumber: 3,
      }),
    ).toBe(true);
  });

  it("rejects ranges where end precedes start", () => {
    expect(
      isValidLeagueRange({
        startSeasonType: "regular",
        startWeekNumber: 10,
        endSeasonType: "regular",
        endWeekNumber: 2,
      }),
    ).toBe(false);
  });

  it("orders regular before postseason", () => {
    expect(
      isValidLeagueRange({
        startSeasonType: "postseason",
        startWeekNumber: 1,
        endSeasonType: "regular",
        endWeekNumber: 18,
      }),
    ).toBe(false);
  });
});

describe("phaseLabel / formatLeagueRange", () => {
  it("labels regular-season weeks with the week number", () => {
    expect(phaseLabel("regular", 1)).toBe("Week 1");
    expect(phaseLabel("regular", 18)).toBe("Week 18");
  });

  it("labels postseason with round names", () => {
    expect(phaseLabel("postseason", 1)).toBe("Wild Card");
    expect(phaseLabel("postseason", 2)).toBe("Divisional");
    expect(phaseLabel("postseason", 3)).toBe("Conference");
    expect(phaseLabel("postseason", 5)).toBe("Super Bowl");
  });

  it("formats a single-week range as just the week label", () => {
    expect(
      formatLeagueRange({
        startSeasonType: "regular",
        startWeekNumber: 3,
        endSeasonType: "regular",
        endWeekNumber: 3,
      }),
    ).toBe("Week 3");
  });

  it("formats a multi-week range as start → end", () => {
    expect(formatLeagueRange(fullSeasonRange)).toBe("Week 1 → Super Bowl");
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

describe("getLeagueSeasonState", () => {
  const regularWeek1 = phase({
    seasonType: "regular",
    startDate: new Date("2025-09-07T00:00:00Z"),
    endDate: new Date("2025-09-14T00:00:00Z"),
    weekNumber: 1,
  });
  const regularWeek18 = phase({
    seasonType: "regular",
    startDate: new Date("2026-01-04T00:00:00Z"),
    endDate: new Date("2026-01-11T00:00:00Z"),
    weekNumber: 18,
  });
  const wildCard = phase({
    seasonType: "postseason",
    startDate: new Date("2026-01-11T00:00:00Z"),
    endDate: new Date("2026-01-18T00:00:00Z"),
    weekNumber: 1,
  });
  const superBowl = phase({
    seasonType: "postseason",
    startDate: new Date("2026-02-08T00:00:00Z"),
    endDate: new Date("2026-02-15T00:00:00Z"),
    weekNumber: 5,
  });

  it("returns 'upcoming' before any relevant phase has started", () => {
    const now = new Date("2025-08-01T00:00:00Z");
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        regularSeasonRange,
        now,
      ),
    ).toBe("upcoming");
  });

  it("returns 'in_progress' while any relevant phase contains now", () => {
    const now = new Date("2025-09-10T12:00:00Z");
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        regularSeasonRange,
        now,
      ),
    ).toBe("in_progress");
  });

  it("returns 'in_progress' between relevant phases (gap inside the range)", () => {
    const now = new Date("2025-10-01T00:00:00Z");
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18],
        regularSeasonRange,
        now,
      ),
    ).toBe("in_progress");
  });

  it("returns 'complete' once every relevant phase has ended", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        fullSeasonRange,
        now,
      ),
    ).toBe("complete");
  });

  it("ignores phases outside the league's range", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    // In postseason window but league is regular-season only — regular season
    // ended before wildcard started.
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        regularSeasonRange,
        now,
      ),
    ).toBe("complete");
    // And a postseason-only league treats the same moment as in_progress.
    expect(
      getLeagueSeasonState(
        [regularWeek1, regularWeek18, wildCard, superBowl],
        postseasonRange,
        now,
      ),
    ).toBe("in_progress");
  });

  it("returns 'upcoming' when no phases of the range are synced yet", () => {
    const now = new Date("2025-09-10T12:00:00Z");
    expect(getLeagueSeasonState([regularWeek1], postseasonRange, now)).toBe(
      "upcoming",
    );
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
    weekNumber: 1,
  });

  it("resolves the start tuple to the matching phase", () => {
    expect(
      selectLeagueStartPhase([week1, week2, wildCard], regularSeasonRange),
    ).toEqual(week1);
  });

  it("resolves a mid-range start to its matching phase, independent of other weeks", () => {
    const midRange: LeagueRange = {
      startSeasonType: "regular",
      startWeekNumber: 2,
      endSeasonType: "regular",
      endWeekNumber: 18,
    };
    expect(selectLeagueStartPhase([week1, week2, wildCard], midRange)).toEqual(
      week2,
    );
  });

  it("resolves a postseason start to the matching postseason phase", () => {
    expect(
      selectLeagueStartPhase([week1, week2, wildCard], postseasonRange),
    ).toEqual(wildCard);
  });

  it("returns null when the start tuple isn't present in the supplied phases", () => {
    const missingRange: LeagueRange = {
      startSeasonType: "regular",
      startWeekNumber: 10,
      endSeasonType: "regular",
      endWeekNumber: 18,
    };
    expect(
      selectLeagueStartPhase([week1, week2, wildCard], missingRange),
    ).toBeNull();
  });
});

describe("hasLeagueStartLockPassed", () => {
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

  it("returns false before the start phase's pick lock", () => {
    const now = new Date("2025-09-07T10:00:00Z");
    expect(
      hasLeagueStartLockPassed([week1, week2], regularSeasonRange, now),
    ).toBe(false);
  });

  it("returns true at the exact pick lock time", () => {
    const now = new Date("2025-09-07T17:00:00Z");
    expect(
      hasLeagueStartLockPassed([week1, week2], regularSeasonRange, now),
    ).toBe(true);
  });

  it("keys off the configured start week, not the earliest in the list", () => {
    const midRange: LeagueRange = {
      startSeasonType: "regular",
      startWeekNumber: 2,
      endSeasonType: "regular",
      endWeekNumber: 18,
    };
    // After Week 1's lock but before Week 2's — start tuple is Week 2, so
    // still unlocked.
    expect(
      hasLeagueStartLockPassed(
        [week1, week2],
        midRange,
        new Date("2025-09-14T10:00:00Z"),
      ),
    ).toBe(false);
    // After Week 2's lock → locked.
    expect(
      hasLeagueStartLockPassed(
        [week1, week2],
        midRange,
        new Date("2025-09-15T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("returns false when the start phase isn't synced yet", () => {
    // Start phase absent from the list (e.g. season's phases haven't
    // populated) → lock can't have fired.
    const missingRange: LeagueRange = {
      startSeasonType: "postseason",
      startWeekNumber: 5,
      endSeasonType: "postseason",
      endWeekNumber: 5,
    };
    expect(
      hasLeagueStartLockPassed(
        [week1, week2],
        missingRange,
        new Date("2099-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
});

describe("selectLeagueCurrentPhase", () => {
  const week1 = phase({
    seasonType: "regular",
    startDate: new Date("2025-09-07T00:00:00Z"),
    endDate: new Date("2025-09-14T00:00:00Z"),
    weekNumber: 1,
  });
  const week2 = phase({
    seasonType: "regular",
    startDate: new Date("2025-09-14T00:00:00Z"),
    endDate: new Date("2025-09-21T00:00:00Z"),
    weekNumber: 2,
  });
  const week18 = phase({
    seasonType: "regular",
    startDate: new Date("2026-01-04T00:00:00Z"),
    endDate: new Date("2026-01-11T00:00:00Z"),
    weekNumber: 18,
  });
  const wildCard = phase({
    seasonType: "postseason",
    startDate: new Date("2026-01-11T00:00:00Z"),
    endDate: new Date("2026-01-18T00:00:00Z"),
    weekNumber: 1,
  });

  it("returns the active phase when now falls inside it", () => {
    const now = new Date("2025-09-10T12:00:00Z");
    expect(
      selectLeagueCurrentPhase(
        [week1, week2, week18, wildCard],
        regularSeasonRange,
        now,
      ),
    ).toEqual(week1);
  });

  it("returns the nearest upcoming phase between weeks", () => {
    const now = new Date("2025-09-21T00:00:00Z");
    expect(
      selectLeagueCurrentPhase([week1, week2, week18], regularSeasonRange, now),
    ).toEqual(week18);
  });

  it("returns the latest phase after the season ends", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(
      selectLeagueCurrentPhase([week1, week2, week18], regularSeasonRange, now),
    ).toEqual(week18);
  });

  it("returns the first phase before the season starts", () => {
    const now = new Date("2025-08-01T00:00:00Z");
    expect(
      selectLeagueCurrentPhase([week1, week2, week18], regularSeasonRange, now),
    ).toEqual(week1);
  });

  it("ignores phases outside the league range", () => {
    // During the wild card week; regular-season-only league defaults back to
    // its last week rather than jumping to the postseason phase.
    const now = new Date("2026-01-15T00:00:00Z");
    expect(
      selectLeagueCurrentPhase(
        [week1, week2, week18, wildCard],
        regularSeasonRange,
        now,
      ),
    ).toEqual(week18);
    // Postseason-only league resolves to wild card during the same moment.
    expect(
      selectLeagueCurrentPhase(
        [week1, week2, week18, wildCard],
        postseasonRange,
        now,
      ),
    ).toEqual(wildCard);
  });

  it("returns null when the range has no synced phases", () => {
    expect(
      selectLeagueCurrentPhase([week1], postseasonRange, new Date()),
    ).toBeNull();
  });
});

describe("isPhaseLocked", () => {
  const phaseLock = {
    pickLockTime: new Date("2025-09-07T17:00:00Z"),
  } as Pick<Phase, "pickLockTime">;

  it("returns false before pick lock time", () => {
    expect(isPhaseLocked(phaseLock, new Date("2025-09-07T16:59:59Z"))).toBe(
      false,
    );
  });

  it("returns true at the pick lock time", () => {
    expect(isPhaseLocked(phaseLock, new Date("2025-09-07T17:00:00Z"))).toBe(
      true,
    );
  });
});

describe("isPickLocked", () => {
  const sundayGame = {
    startTime: new Date("2025-09-07T17:00:00Z"),
  } as Pick<Event, "startTime">;
  const thursdayNightGame = {
    startTime: new Date("2025-09-04T00:20:00Z"),
  } as Pick<Event, "startTime">;
  const phaseLock = {
    pickLockTime: new Date("2025-09-07T17:00:00Z"),
  } as Pick<Phase, "pickLockTime">;

  it("returns false before both the phase lock and the game start", () => {
    const now = new Date("2025-09-03T00:00:00Z");
    expect(isPickLocked(phaseLock, sundayGame, now)).toBe(false);
  });

  it("returns true at the phase lock time", () => {
    const now = new Date("2025-09-07T17:00:00Z");
    expect(isPickLocked(phaseLock, sundayGame, now)).toBe(true);
  });

  it("returns true when the individual game has kicked off before the phase lock", () => {
    const now = new Date("2025-09-04T00:30:00Z");
    expect(isPickLocked(phaseLock, thursdayNightGame, now)).toBe(true);
    // But a Sunday game is still unlocked at the same moment.
    expect(isPickLocked(phaseLock, sundayGame, now)).toBe(false);
  });
});
