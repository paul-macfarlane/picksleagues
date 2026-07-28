import { describe, expect, it } from "vitest";
import { combineLocalDateTimeValue, splitLocalDateTimeValue } from "./date-time-value";

describe("splitLocalDateTimeValue", () => {
  it("treats an empty value as unset", () => {
    expect(splitLocalDateTimeValue("")).toEqual({ date: undefined, time: "" });
  });

  it("splits a well-formed local value into its date and time parts", () => {
    const { date, time } = splitLocalDateTimeValue("2026-07-26T18:05");

    expect(time).toBe("18:05");
    // Local getters, not UTC — the whole point of the "local" value.
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(6);
    expect(date?.getDate()).toBe(26);
    expect(date?.getHours()).toBe(18);
    expect(date?.getMinutes()).toBe(5);
  });

  it("reports no time when the value has none", () => {
    const { date, time } = splitLocalDateTimeValue("2026-07-26");

    expect(time).toBe("");
    expect(date?.getFullYear()).toBe(2026);
  });

  it("reports an unparseable value as unset rather than throwing", () => {
    expect(splitLocalDateTimeValue("not-a-date")).toEqual({ date: undefined, time: "" });
  });
});

describe("combineLocalDateTimeValue", () => {
  it("combines a date and time into the datetime-local shape", () => {
    const date = new Date(2026, 6, 26); // July 26 2026, local
    expect(combineLocalDateTimeValue(date, "09:30")).toBe("2026-07-26T09:30");
  });

  it("defaults to midnight when no time has been chosen yet", () => {
    const date = new Date(2026, 6, 26);
    expect(combineLocalDateTimeValue(date, "")).toBe("2026-07-26T00:00");
  });

  it("pads single-digit months and days", () => {
    const date = new Date(2026, 0, 5); // Jan 5 2026
    expect(combineLocalDateTimeValue(date, "01:02")).toBe("2026-01-05T01:02");
  });

  it("round-trips through split for a value that survives the (empty) TIME_PATTERN default", () => {
    const original = "2026-12-31T23:59";
    const { date, time } = splitLocalDateTimeValue(original);
    if (!date) throw new Error("expected a parsed date");
    expect(combineLocalDateTimeValue(date, time)).toBe(original);
  });
});
