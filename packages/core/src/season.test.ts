import { describe, expect, it } from "vitest";
import { WEEK_TYPE } from "@picksleagues/schemas";
import { ESPN_POSTSEASON_NUMBER_BY_DOMAIN } from "./espn-provider";
import {
  estimatedNflWeeks,
  latestCompletedNflSeasonYear,
  nflSeasonAlignedAnchor,
  nflSeasonYearFor,
} from "./season";

describe("nflSeasonYearFor", () => {
  it.each([
    { label: "mid-September", now: "2026-09-15T00:00:00Z", expected: 2026 },
    { label: "January (Super Bowl window)", now: "2027-01-15T00:00:00Z", expected: 2026 },
    { label: "February", now: "2027-02-10T00:00:00Z", expected: 2026 },
    { label: "March", now: "2027-03-01T00:00:00Z", expected: 2026 },
    { label: "July", now: "2027-07-31T23:59:59Z", expected: 2026 },
    { label: "August 1", now: "2027-08-01T00:00:00Z", expected: 2027 },
    { label: "December 31", now: "2026-12-31T23:59:59Z", expected: 2026 },
  ])("$label -> $expected", ({ now, expected }) => {
    expect(nflSeasonYearFor(new Date(now))).toBe(expected);
  });
});

describe("latestCompletedNflSeasonYear", () => {
  it.each([
    { label: "well past the Super Bowl", now: "2026-07-26T00:00:00Z", expected: 2025 },
    { label: "March 1 UTC boundary, at the instant", now: "2026-03-01T00:00:00Z", expected: 2025 },
    {
      label: "one second before the March 1 boundary",
      now: "2026-02-28T23:59:59Z",
      expected: 2024,
    },
    { label: "mid-January, season still in progress", now: "2026-01-15T00:00:00Z", expected: 2024 },
    { label: "mid-September, new season underway", now: "2026-09-15T00:00:00Z", expected: 2025 },
    { label: "leap day", now: "2024-02-29T00:00:00Z", expected: 2022 },
  ])("$label -> $expected", ({ now, expected }) => {
    expect(latestCompletedNflSeasonYear(new Date(now))).toBe(expected);
  });
});

// The regression this exists for: a ~7-day scenario loaded on 2026-07-29 ends
// on 2026-08-05, so its games sit in season 2026 while `nflSeasonYearFor(now)`
// still reads 2025 — the simulator's sync jobs then ask for a season the
// scenario doesn't cover and no-op. The window is only the last days of July,
// which is why it surfaced as a merge-gate E2E failure and not in review.
describe("nflSeasonAlignedAnchor", () => {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  it.each([
    {
      label: "mid-season: already inside one label, returned unchanged",
      earliest: "2026-10-01T12:00:00Z",
      spanMs: WEEK_MS,
      expected: "2026-10-01T12:00:00.000Z",
    },
    {
      label: "spanning New Year: no flip there, so unchanged",
      earliest: "2026-12-29T12:00:00Z",
      spanMs: 2 * WEEK_MS,
      expected: "2026-12-29T12:00:00.000Z",
    },
    {
      label: "late July, span crosses Aug 1: snapped to the flip",
      earliest: "2026-07-29T01:25:00Z",
      spanMs: WEEK_MS,
      expected: "2026-08-01T00:00:00.000Z",
    },
    {
      label: "early July, span ends before Aug 1: unchanged",
      earliest: "2026-07-01T00:00:00Z",
      spanMs: WEEK_MS,
      expected: "2026-07-01T00:00:00.000Z",
    },
    {
      label: "July 31, span ends one ms past the flip: snapped",
      earliest: "2026-07-31T23:59:59.999Z",
      spanMs: 2,
      expected: "2026-08-01T00:00:00.000Z",
    },
    {
      label: "span ending exactly at the flip stays on the near side",
      earliest: "2026-07-31T00:00:00Z",
      spanMs: 24 * 60 * 60 * 1000,
      expected: "2026-08-01T00:00:00.000Z",
    },
    {
      label: "already at the flip: unchanged",
      earliest: "2026-08-01T00:00:00Z",
      spanMs: WEEK_MS,
      expected: "2026-08-01T00:00:00.000Z",
    },
    {
      label: "Jan-Jul maps back a year, so the snap is the *next* calendar Aug",
      earliest: "2027-07-30T00:00:00Z",
      spanMs: WEEK_MS,
      expected: "2027-08-01T00:00:00.000Z",
    },
  ])("$label", ({ earliest, spanMs, expected }) => {
    expect(nflSeasonAlignedAnchor(new Date(earliest), spanMs).toISOString()).toBe(expected);
  });

  it("the returned anchor labels the whole span, whenever it is loaded", () => {
    // Every hour of a year: the property the simulator depends on, rather than
    // trusting the handful of boundaries enumerated above.
    const HOUR_MS = 60 * 60 * 1000;
    const start = Date.UTC(2026, 0, 1);
    for (let t = start; t < start + 365 * 24 * HOUR_MS; t += HOUR_MS) {
      const anchor = nflSeasonAlignedAnchor(new Date(t), 2 * WEEK_MS);
      expect(anchor.getTime()).toBeGreaterThanOrEqual(t);
      expect(nflSeasonYearFor(new Date(anchor.getTime() + 2 * WEEK_MS))).toBe(
        nflSeasonYearFor(anchor),
      );
    }
  });
});

describe("estimatedNflWeeks", () => {
  it.each([
    { seasonYear: 2026, expectedWeek1Start: "2026-09-03T00:00:00.000Z" },
    { seasonYear: 2027, expectedWeek1Start: "2027-09-02T00:00:00.000Z" },
  ])(
    "$seasonYear: week 1 starts on the first Thursday of September ($expectedWeek1Start)",
    ({ seasonYear, expectedWeek1Start }) => {
      const weeks = estimatedNflWeeks(seasonYear);
      const week1 = weeks.find(
        (week) => week.weekType === WEEK_TYPE.REGULAR && week.weekNumber === 1,
      );
      expect(week1?.startsAt).toEqual(new Date(expectedWeek1Start));
      // The anchor date must actually be a Thursday, not just plausible-looking.
      expect(week1?.startsAt.getUTCDay()).toBe(4);
    },
  );

  it("returns 18 regular weeks and 4 postseason weeks", () => {
    const weeks = estimatedNflWeeks(2026);
    expect(weeks.filter((week) => week.weekType === WEEK_TYPE.REGULAR)).toHaveLength(18);
    expect(weeks.filter((week) => week.weekType === WEEK_TYPE.POSTSEASON)).toHaveLength(4);
    expect(weeks).toHaveLength(22);
  });

  it("labels regular weeks 'Week N' and postseason weeks by round name, in order", () => {
    const weeks = estimatedNflWeeks(2026);
    const regularLabels = weeks
      .filter((week) => week.weekType === WEEK_TYPE.REGULAR)
      .map((week) => week.label);
    expect(regularLabels).toEqual(Array.from({ length: 18 }, (_, i) => `Week ${i + 1}`));

    const postseasonLabels = weeks
      .filter((week) => week.weekType === WEEK_TYPE.POSTSEASON)
      .map((week) => week.label);
    expect(postseasonLabels).toEqual([
      "Wild Card",
      "Divisional Round",
      "Conference Championship",
      "Super Bowl",
    ]);
  });

  it("numbers postseason weeks with exactly the domain keys the ESPN adapter translates to (couples the two so they can't drift)", () => {
    const postseasonNumbers = estimatedNflWeeks(2026)
      .filter((week) => week.weekType === WEEK_TYPE.POSTSEASON)
      .map((week) => week.weekNumber);
    // The adapter's translation map keys ARE the domain postseason numbering
    // (Wild Card=1 … Super Bowl=4); a change on either side without the other
    // breaks this assertion loudly rather than silently orphaning a week.
    expect(postseasonNumbers).toEqual(Object.keys(ESPN_POSTSEASON_NUMBER_BY_DOMAIN).map(Number));
  });

  it("each week spans exactly 7 days", () => {
    for (const week of estimatedNflWeeks(2026)) {
      expect(week.endsAt.getTime() - week.startsAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  it("regular weeks are contiguous and monotonically increasing", () => {
    const regularWeeks = estimatedNflWeeks(2026).filter(
      (week) => week.weekType === WEEK_TYPE.REGULAR,
    );
    for (let i = 1; i < regularWeeks.length; i++) {
      expect(regularWeeks[i]?.startsAt.getTime()).toBe(regularWeeks[i - 1]?.endsAt.getTime());
    }
  });

  it("postseason weeks are monotonically increasing with a one-week gap before the Super Bowl", () => {
    const postseasonWeeks = estimatedNflWeeks(2026).filter(
      (week) => week.weekType === WEEK_TYPE.POSTSEASON,
    );
    const [wildCard, divisional, conference, superBowl] = postseasonWeeks;
    expect(divisional?.startsAt).toEqual(wildCard?.endsAt);
    expect(conference?.startsAt).toEqual(divisional?.endsAt);
    // A full extra week between the conference championships and the Super
    // Bowl, not the back-to-back cadence of the earlier rounds.
    expect(superBowl?.startsAt.getTime()).toBe(
      (conference?.endsAt.getTime() ?? 0) + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it("the postseason begins after the last regular week ends", () => {
    const weeks = estimatedNflWeeks(2026);
    const lastRegular = weeks.find(
      (week) => week.weekType === WEEK_TYPE.REGULAR && week.weekNumber === 18,
    );
    const wildCard = weeks.find(
      (week) => week.weekType === WEEK_TYPE.POSTSEASON && week.weekNumber === 1,
    );
    expect(wildCard?.startsAt.getTime()).toBeGreaterThanOrEqual(lastRegular?.endsAt.getTime() ?? 0);
  });
});
