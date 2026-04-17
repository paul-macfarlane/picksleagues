import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EspnApiError,
  espnFetch,
  espnFetchRef,
  mapWithConcurrency,
  nflEventsUrl,
  nflTeamsUrl,
  nflWeeksUrl,
} from "./client";

describe("espnFetch", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockReset();
  });

  it("returns parsed JSON on success", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
    );

    const data = await espnFetch<{ hello: string }>("https://espn.test/x");

    expect(data).toEqual({ hello: "world" });
    expect(fetchSpy).toHaveBeenCalledWith("https://espn.test/x");
  });

  it("throws EspnApiError immediately on non-retriable status (404)", async () => {
    fetchSpy.mockResolvedValue(
      new Response("nope", { status: 404, statusText: "Not Found" }),
    );

    await expect(espnFetch("https://espn.test/x")).rejects.toBeInstanceOf(
      EspnApiError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on 500 and succeeds when the next attempt returns 200", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response("down", { status: 500, statusText: "Server Error" }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    const promise = espnFetch<{ ok: boolean }>("https://espn.test/x");
    await vi.runAllTimersAsync();
    const data = await promise;

    expect(data).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate-limit", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, statusText: "Too Many" }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    const promise = espnFetch<{ ok: boolean }>("https://espn.test/x");
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on ENOTFOUND network failures", async () => {
    const networkError = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ENOTFOUND" },
    });
    fetchSpy
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    const promise = espnFetch<{ ok: boolean }>("https://espn.test/x");
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("gives up after MAX_RETRIES on persistent failure", async () => {
    fetchSpy.mockResolvedValue(
      new Response("boom", { status: 503, statusText: "Unavailable" }),
    );

    const promise = espnFetch("https://espn.test/x");
    // Must attach the rejection assertion before driving the timers so the
    // thrown error doesn't surface as an unhandled rejection.
    const assertion = expect(promise).rejects.toBeInstanceOf(EspnApiError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not retry unrelated TypeErrors", async () => {
    fetchSpy.mockRejectedValue(new TypeError("invalid URL"));

    await expect(espnFetch("https://espn.test/x")).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("espnFetchRef resolves $ref URL", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await espnFetchRef({ $ref: "https://espn.test/ref" });

    expect(fetchSpy).toHaveBeenCalledWith("https://espn.test/ref");
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in the result", async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await mapWithConcurrency(items, 2, async (n) => n * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it("caps in-flight calls at the concurrency limit and actually parallelises", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      return null;
    });

    // Upper bound — never exceed the limit.
    expect(maxInFlight).toBeLessThanOrEqual(3);
    // Lower bound — catches a regression to serial execution.
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("returns an empty array for empty input", async () => {
    const fn = vi.fn();
    const result = await mapWithConcurrency([], 5, fn);
    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("propagates the first error", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("aborts sibling workers after the first error instead of leaking rejections", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const started: number[] = [];
    try {
      await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
        started.push(n);
        if (n === 1) {
          await new Promise((r) => setTimeout(r, 0));
          throw new Error("first worker fails");
        }
        if (n === 2) {
          await new Promise((r) => setTimeout(r, 0));
          throw new Error("second worker fails");
        }
        await new Promise((r) => setTimeout(r, 0));
        return n;
      });
    } catch {
      // expected
    }

    // Give the microtask queue a chance to surface any unhandled rejection.
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
    // Abort flag should prevent pulling items past the two in-flight failures.
    expect(started.length).toBeLessThan(8);
  });
});

describe("url builders", () => {
  it("weeksUrl includes year, type, and limit=100", () => {
    expect(nflWeeksUrl(2025, 2)).toContain("/seasons/2025/types/2/weeks");
    expect(nflWeeksUrl(2025, 2)).toContain("limit=100");
  });

  it("teamsUrl includes year", () => {
    expect(nflTeamsUrl(2025)).toContain("/seasons/2025/teams");
  });

  it("eventsUrl includes year, type, and week", () => {
    expect(nflEventsUrl(2025, 2, 5)).toContain(
      "/seasons/2025/types/2/weeks/5/events",
    );
  });
});
