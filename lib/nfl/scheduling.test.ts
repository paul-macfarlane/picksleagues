import { describe, expect, it } from "vitest";

import {
  calculatePhaseEndBoundary,
  calculatePhaseStartBoundary,
  calculatePickLockTime,
} from "./scheduling";

describe("calculatePickLockTime", () => {
  describe("regular season (lock on Sunday 1 PM ET)", () => {
    it("phase starting Tuesday → next Sunday 1 PM ET", () => {
      // Tuesday Sept 9, 2025 (EDT, UTC-4)
      const phaseStart = new Date("2025-09-09T10:00:00Z");
      const result = calculatePickLockTime(phaseStart, "regular");

      // Sunday Sept 14, 2025 at 1 PM EDT = 5 PM UTC
      expect(result).toEqual(new Date("2025-09-14T17:00:00.000Z"));
    });

    it("phase starting Sunday → that same Sunday 1 PM ET", () => {
      // Sunday Sept 7, 2025 at midnight UTC (still Saturday in ET)
      // Actually, let's use a time that's clearly Sunday in ET
      const phaseStart = new Date("2025-09-07T10:00:00Z"); // 6 AM EDT = Sunday
      const result = calculatePickLockTime(phaseStart, "regular");

      // Same Sunday at 1 PM EDT = 5 PM UTC
      expect(result).toEqual(new Date("2025-09-07T17:00:00.000Z"));
    });

    it("phase starting Wednesday → next Sunday 1 PM ET", () => {
      // Wednesday Oct 1, 2025 (EDT)
      const phaseStart = new Date("2025-10-01T12:00:00Z");
      const result = calculatePickLockTime(phaseStart, "regular");

      // Sunday Oct 5, 2025 at 1 PM EDT = 5 PM UTC
      expect(result).toEqual(new Date("2025-10-05T17:00:00.000Z"));
    });

    it("handles EST (winter) correctly", () => {
      // Tuesday Dec 2, 2025 (EST, UTC-5)
      const phaseStart = new Date("2025-12-02T15:00:00Z");
      const result = calculatePickLockTime(phaseStart, "regular");

      // Sunday Dec 7, 2025 at 1 PM EST = 6 PM UTC
      expect(result).toEqual(new Date("2025-12-07T18:00:00.000Z"));
    });
  });

  describe("postseason (lock on Saturday 1 PM ET)", () => {
    it("phase starting Wednesday → next Saturday 1 PM ET", () => {
      // Wednesday Jan 7, 2026 (EST, UTC-5)
      const phaseStart = new Date("2026-01-07T15:00:00Z");
      const result = calculatePickLockTime(phaseStart, "postseason");

      // Saturday Jan 10, 2026 at 1 PM EST = 6 PM UTC
      expect(result).toEqual(new Date("2026-01-10T18:00:00.000Z"));
    });

    it("phase starting Saturday → that same Saturday 1 PM ET", () => {
      // Saturday Jan 10, 2026 (EST)
      const phaseStart = new Date("2026-01-10T10:00:00Z"); // 5 AM EST = Saturday
      const result = calculatePickLockTime(phaseStart, "postseason");

      // Same Saturday at 1 PM EST = 6 PM UTC
      expect(result).toEqual(new Date("2026-01-10T18:00:00.000Z"));
    });

    it("phase starting Sunday → next Saturday 1 PM ET", () => {
      // Sunday Jan 11, 2026 (EST)
      const phaseStart = new Date("2026-01-11T15:00:00Z");
      const result = calculatePickLockTime(phaseStart, "postseason");

      // Saturday Jan 17, 2026 at 1 PM EST = 6 PM UTC
      expect(result).toEqual(new Date("2026-01-17T18:00:00.000Z"));
    });
  });
});

describe("calculatePhaseStartBoundary", () => {
  it("Thursday game → previous Tuesday 2 AM ET", () => {
    // Thursday Sept 11, 2025 at 8:20 PM EDT (00:20 UTC Friday)
    const event = new Date("2025-09-12T00:20:00Z");
    const result = calculatePhaseStartBoundary(event);

    // Tuesday Sept 9, 2025 at 2 AM EDT = 6 AM UTC
    expect(result).toEqual(new Date("2025-09-09T06:00:00.000Z"));
  });

  it("Sunday game → previous Tuesday 2 AM ET", () => {
    // Sunday Sept 14, 2025 at 1 PM EDT = 5 PM UTC
    const event = new Date("2025-09-14T17:00:00Z");
    const result = calculatePhaseStartBoundary(event);

    // Tuesday Sept 9, 2025 at 2 AM EDT = 6 AM UTC
    expect(result).toEqual(new Date("2025-09-09T06:00:00.000Z"));
  });

  it("Tuesday 1 AM ET event → previous week's Tuesday 2 AM ET", () => {
    // Tuesday Sept 16, 2025 at 1 AM EDT = 5 AM UTC (before 2 AM boundary)
    const event = new Date("2025-09-16T05:00:00Z");
    const result = calculatePhaseStartBoundary(event);

    // Tuesday Sept 9, 2025 at 2 AM EDT = 6 AM UTC
    expect(result).toEqual(new Date("2025-09-09T06:00:00.000Z"));
  });

  it("handles EST (winter) correctly", () => {
    // Thursday Dec 4, 2025 at 8:20 PM EST = 1:20 AM UTC Friday
    const event = new Date("2025-12-05T01:20:00Z");
    const result = calculatePhaseStartBoundary(event);

    // Tuesday Dec 2, 2025 at 2 AM EST = 7 AM UTC
    expect(result).toEqual(new Date("2025-12-02T07:00:00.000Z"));
  });
});

describe("calculatePhaseEndBoundary", () => {
  it("Monday night game → next Tuesday 2 AM ET", () => {
    // Monday Sept 15, 2025 at 8:15 PM EDT = 12:15 AM UTC Tuesday
    const event = new Date("2025-09-16T00:15:00Z");
    const result = calculatePhaseEndBoundary(event);

    // Tuesday Sept 16, 2025 at 2 AM EDT = 6 AM UTC
    expect(result).toEqual(new Date("2025-09-16T06:00:00.000Z"));
  });

  it("Sunday game → next Tuesday 2 AM ET", () => {
    // Sunday Sept 14, 2025 at 4:25 PM EDT
    const event = new Date("2025-09-14T20:25:00Z");
    const result = calculatePhaseEndBoundary(event);

    // Tuesday Sept 16, 2025 at 2 AM EDT = 6 AM UTC
    expect(result).toEqual(new Date("2025-09-16T06:00:00.000Z"));
  });

  it("Tuesday 3 AM ET event → next week's Tuesday 2 AM ET", () => {
    // Tuesday Sept 16, 2025 at 3 AM EDT = 7 AM UTC (after 2 AM boundary)
    const event = new Date("2025-09-16T07:00:00Z");
    const result = calculatePhaseEndBoundary(event);

    // Tuesday Sept 23, 2025 at 2 AM EDT = 6 AM UTC
    expect(result).toEqual(new Date("2025-09-23T06:00:00.000Z"));
  });

  it("handles EST (winter) correctly", () => {
    // Monday Dec 8, 2025 at 8:15 PM EST = 1:15 AM UTC Tuesday
    const event = new Date("2025-12-09T01:15:00Z");
    const result = calculatePhaseEndBoundary(event);

    // Tuesday Dec 9, 2025 at 2 AM EST = 7 AM UTC
    expect(result).toEqual(new Date("2025-12-09T07:00:00.000Z"));
  });
});
