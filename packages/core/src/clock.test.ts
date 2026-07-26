import { describe, expect, it, vi } from "vitest";
import { FixedClock, OffsetClock, SystemClock, resolveClock } from "./clock";

describe("FixedClock", () => {
  it("returns the pinned instant", () => {
    const pinned = new Date("2026-09-10T13:00:00Z");
    const clock = new FixedClock(pinned);

    expect(clock.now()).toEqual(pinned);
  });

  it("returns a copy, not the same mutable Date object", () => {
    const pinned = new Date("2026-09-10T13:00:00Z");
    const clock = new FixedClock(pinned);

    const first = clock.now();
    expect(first).not.toBe(pinned);

    first.setUTCFullYear(2000);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});

describe("OffsetClock", () => {
  const base = new FixedClock(new Date("2026-09-10T13:00:00Z"));

  it.each([
    { label: "positive offset shifts forward", offsetMs: 60_000, expected: "2026-09-10T13:01:00Z" },
    {
      label: "negative offset shifts backward",
      offsetMs: -60_000,
      expected: "2026-09-10T12:59:00Z",
    },
    { label: "zero offset is a no-op", offsetMs: 0, expected: "2026-09-10T13:00:00Z" },
  ])("$label", ({ offsetMs, expected }) => {
    const clock = new OffsetClock(base, offsetMs);
    expect(clock.now()).toEqual(new Date(expected));
  });
});

describe("resolveClock", () => {
  it("returns SystemClock without invoking the offset reader when the simulator is off", async () => {
    const readSimOffsetMs = vi.fn();

    const clock = await resolveClock(false, readSimOffsetMs);

    expect(clock).toBeInstanceOf(SystemClock);
    expect(readSimOffsetMs).not.toHaveBeenCalled();
  });

  it("returns an offset clock using the reader's value when the simulator is on", async () => {
    const readSimOffsetMs = vi.fn().mockResolvedValue(120_000);

    const clock = await resolveClock(true, readSimOffsetMs);

    expect(clock).toBeInstanceOf(OffsetClock);
    expect(readSimOffsetMs).toHaveBeenCalledTimes(1);

    const before = Date.now();
    const now = clock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before + 120_000 - 1_000);
    expect(now).toBeLessThanOrEqual(before + 120_000 + 1_000);
  });
});
