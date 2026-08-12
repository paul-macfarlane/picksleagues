import { describe, expect, it } from "vitest";
import { FixedClock } from "@picksleagues/core";
import { LEAGUE_MODE, NFL_REGULAR_SEASON_RANGE, PICK_TYPE, WEEK_TYPE } from "@picksleagues/schemas";
import {
  resolveCurrentWeekId,
  resolveCurrentWeekLabel,
  resolveWeekWindowPosition,
} from "./league-weeks";

// The stored Pick'em settings shape, of which only the week range matters here.
const DEFAULT_RANGE = {
  ...NFL_REGULAR_SEASON_RANGE,
  pickType: PICK_TYPE.STRAIGHT_UP,
  picksPerWeek: 5,
};

/**
 * Boundary instants for the current-week and pick-window derivations
 * (ADR-0036). Everything clock-derived in the window rests on these two pure
 * functions, so the half-open edges are pinned here rather than re-arranged
 * per mode in the integration suites.
 */

const day = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-09-10T00:00:00.000Z").getTime();

// Three contiguous weeks: [t0, t0+7d), [t0+7d, t0+14d), [t0+14d, t0+21d).
const WEEKS = [
  { id: "w1", startsAt: new Date(t0), endsAt: new Date(t0 + 7 * day) },
  { id: "w2", startsAt: new Date(t0 + 7 * day), endsAt: new Date(t0 + 14 * day) },
  { id: "w3", startsAt: new Date(t0 + 14 * day), endsAt: new Date(t0 + 21 * day) },
];

const at = (ms: number) => new FixedClock(new Date(ms));

describe("resolveCurrentWeekId", () => {
  it.each([
    { label: "before the season", now: t0 - day, expected: "w1" },
    { label: "exactly at a week's startsAt (inclusive)", now: t0 + 7 * day, expected: "w2" },
    { label: "one ms before a week's endsAt", now: t0 + 7 * day - 1, expected: "w1" },
    { label: "mid-week", now: t0 + 10 * day, expected: "w2" },
    { label: "after the last week (last-played fallback)", now: t0 + 30 * day, expected: "w3" },
  ])("$label → $expected", ({ now, expected }) => {
    expect(resolveCurrentWeekId(WEEKS, at(now))).toBe(expected);
  });

  it("returns null with no weeks", () => {
    expect(resolveCurrentWeekId([], at(t0))).toBeNull();
  });
});

describe("resolveWeekWindowPosition", () => {
  it.each([
    { label: "the current week", now: t0 + day, target: "w1", position: "current" },
    { label: "the week after the current one", now: t0 + day, target: "w2", position: "next" },
    { label: "two weeks ahead", now: t0 + day, target: "w3", position: "closed" },
    { label: "a played week", now: t0 + 10 * day, target: "w1", position: "behind" },
    {
      label: "every earlier week under the last-played fallback",
      now: t0 + 30 * day,
      target: "w2",
      position: "behind",
    },
    { label: "an id not in the rows", now: t0 + day, target: "nope", position: "closed" },
  ])("$label → $position", ({ now, target, position }) => {
    expect(resolveWeekWindowPosition(WEEKS, at(now), target).position).toBe(position);
  });

  it("names the current week on the next position, and never points past the last row", () => {
    const next = resolveWeekWindowPosition(WEEKS, at(t0 + 10 * day), "w3");
    expect(next).toEqual({ position: "next", currentWeekId: "w2" });
    // w3 is current under the fallback; there is no w4 for "next" to reach.
    expect(resolveWeekWindowPosition(WEEKS, at(t0 + 30 * day), "w3").position).toBe("current");
  });
});

describe("resolveCurrentWeekLabel", () => {
  // The same three weeks, given the season identity the range clip needs. Weeks
  // 1–3 of the regular season, so a league ending at week 2 must not name w3.
  const LABELLED = WEEKS.map((week, index) => ({
    ...week,
    weekType: WEEK_TYPE.REGULAR,
    weekNumber: index + 1,
    label: `Week ${index + 1}`,
  }));

  const settingsFor = (endWeekNumber: number) => ({
    ...DEFAULT_RANGE,
    endWeek: { type: WEEK_TYPE.REGULAR, number: endWeekNumber },
  });

  it("names the week the league is currently on", () => {
    expect(
      resolveCurrentWeekLabel(
        LABELLED,
        { mode: LEAGUE_MODE.PICKEM, settings: settingsFor(18) },
        at(t0 + 10 * day),
      ),
    ).toBe("Week 2");
  });

  it("clips to the weeks the league plays, so a finished range names its own last week", () => {
    // Now sits inside week 3, which this league doesn't play — the answer is
    // its last in-range week, not the calendar's current one.
    expect(
      resolveCurrentWeekLabel(
        LABELLED,
        { mode: LEAGUE_MODE.PICKEM, settings: settingsFor(2) },
        at(t0 + 16 * day),
      ),
    ).toBe("Week 2");
  });

  it("is null for a mode with no season range", () => {
    expect(
      resolveCurrentWeekLabel(
        LABELLED,
        { mode: LEAGUE_MODE.MARCH_MADNESS, settings: {} },
        at(t0 + 10 * day),
      ),
    ).toBeNull();
  });

  it("is null before a season's weeks are ingested", () => {
    expect(
      resolveCurrentWeekLabel(
        [],
        { mode: LEAGUE_MODE.SURVIVOR, settings: settingsFor(18) },
        at(t0 + 10 * day),
      ),
    ).toBeNull();
  });
});
