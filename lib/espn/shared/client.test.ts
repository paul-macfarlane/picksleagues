import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EspnApiError,
  espnFetch,
  espnFetchRef,
  nflEventsUrl,
  nflTeamsUrl,
  nflWeeksUrl,
} from "./client";

describe("espnFetch", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
  });

  afterEach(() => {
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

  it("throws EspnApiError on non-2xx response", async () => {
    fetchSpy.mockResolvedValue(
      new Response("nope", { status: 500, statusText: "Server Error" }),
    );

    await expect(espnFetch("https://espn.test/x")).rejects.toBeInstanceOf(
      EspnApiError,
    );
  });

  it("espnFetchRef resolves $ref URL", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await espnFetchRef({ $ref: "https://espn.test/ref" });

    expect(fetchSpy).toHaveBeenCalledWith("https://espn.test/ref");
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
