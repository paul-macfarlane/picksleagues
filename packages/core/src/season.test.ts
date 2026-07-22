import { describe, expect, it } from "vitest";
import { nflSeasonYearFor } from "./season";

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
