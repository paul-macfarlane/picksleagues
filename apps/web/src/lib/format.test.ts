import { describe, expect, it } from "vitest";
import { formatDateTime, formatKickoff } from "./format";

/**
 * Every case builds its instants with the local-time `Date` constructor and
 * asserts only the *relative* half of the output. The time half goes through
 * `toLocaleTimeString`, so pinning it would pin the machine's timezone and
 * locale — and the calendar-day arithmetic is the whole logic here anyway.
 */
describe("formatKickoff", () => {
  // A Sunday, mid-afternoon: far enough from either midnight that adding or
  // subtracting a few hours cannot slide a case into the wrong day by accident.
  const now = new Date(2026, 8, 13, 15, 0);
  const at = (...args: [number, number, number, number, number]) => new Date(...args).toISOString();

  it.each([
    { name: "later the same day", iso: at(2026, 8, 13, 20, 20), expected: "Today " },
    { name: "earlier the same day", iso: at(2026, 8, 13, 9, 30), expected: "Today " },
    { name: "the next day", iso: at(2026, 8, 14, 13, 0), expected: "Tomorrow " },
    { name: "the previous day", iso: at(2026, 8, 12, 20, 15), expected: "Yesterday " },
  ])("names $name", ({ iso, expected }) => {
    expect(formatKickoff(iso, now)).toContain(expected);
  });

  // Two hours later but across midnight: "tomorrow" is a calendar question, not
  // a 24-hour one, which is why both sides collapse to local midnight first.
  it("counts calendar days, not elapsed hours", () => {
    const lateNight = new Date(2026, 8, 13, 23, 30);
    expect(formatKickoff(at(2026, 8, 14, 1, 30), lateNight)).toContain("Tomorrow ");
  });

  it.each([2, 3, 6])("uses the weekday name %i days out", (days) => {
    const label = formatKickoff(at(2026, 8, 13 + days, 13, 0), now);
    // e.g. "Wed 1:00 PM" — the weekday abbreviation, whatever the locale calls
    // it, rather than a numeric date.
    expect(label).not.toMatch(/\d+\/\d+/);
    expect(label).toContain(
      new Date(2026, 8, 13 + days).toLocaleDateString(undefined, {
        weekday: "short",
      }),
    );
  });

  // Seven days out is the same weekday as today, so the name stops being an
  // answer — this is the boundary the whole relative range is bounded by.
  it("falls back to the absolute stamp exactly a week out", () => {
    const iso = at(2026, 8, 20, 13, 0);
    expect(formatKickoff(iso, now)).toBe(formatDateTime(iso));
  });

  it("falls back to the absolute stamp for anything further out", () => {
    const iso = at(2026, 9, 25, 13, 0);
    expect(formatKickoff(iso, now)).toBe(formatDateTime(iso));
  });

  // Only "yesterday" gets a relative name looking backwards: a kickoff further
  // in the past belongs to a finished game, where a date is more use than a
  // count of days.
  it("falls back to the absolute stamp two days back", () => {
    const iso = at(2026, 8, 11, 13, 0);
    expect(formatKickoff(iso, now)).toBe(formatDateTime(iso));
  });
});
