import { beforeEach, describe, expect, it, vi } from "vitest";

import { espnFetch, espnFetchRef } from "@/lib/espn/shared/client";
import { fetchCurrentSeason } from "./seasons";

vi.mock("@/lib/espn/shared/client", () => ({
  espnFetch: vi.fn(),
  espnFetchRef: vi.fn(),
  nflSeasonsUrl: vi.fn().mockReturnValue("https://espn.test/seasons"),
}));

describe("fetchCurrentSeason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockSeasons(
    seasons: Array<{ year: number; startDate: string; endDate: string }>,
  ) {
    vi.mocked(espnFetch).mockResolvedValue({
      items: seasons.map((_, i) => ({ $ref: `https://espn.test/s/${i}` })),
      count: seasons.length,
    });
    for (const s of seasons) {
      vi.mocked(espnFetchRef).mockResolvedValueOnce(s);
    }
  }

  it("returns the season whose date range contains now", async () => {
    mockSeasons([
      {
        year: 2024,
        startDate: "2024-08-01T00:00:00Z",
        endDate: "2025-02-15T00:00:00Z",
      },
      {
        year: 2025,
        startDate: "2025-08-01T00:00:00Z",
        endDate: "2026-02-15T00:00:00Z",
      },
    ]);

    const result = await fetchCurrentSeason(new Date("2025-11-01T00:00:00Z"));

    expect(result.year).toBe(2025);
  });

  it("falls back to next upcoming season when none is active", async () => {
    mockSeasons([
      {
        year: 2024,
        startDate: "2024-08-01T00:00:00Z",
        endDate: "2025-02-15T00:00:00Z",
      },
      {
        year: 2025,
        startDate: "2025-08-01T00:00:00Z",
        endDate: "2026-02-15T00:00:00Z",
      },
    ]);

    const result = await fetchCurrentSeason(new Date("2025-05-01T00:00:00Z"));

    expect(result.year).toBe(2025);
  });

  it("throws when no current or upcoming season exists", async () => {
    mockSeasons([
      {
        year: 2020,
        startDate: "2020-08-01T00:00:00Z",
        endDate: "2021-02-15T00:00:00Z",
      },
    ]);

    await expect(
      fetchCurrentSeason(new Date("2025-05-01T00:00:00Z")),
    ).rejects.toThrow("No current or upcoming NFL season found");
  });
});
