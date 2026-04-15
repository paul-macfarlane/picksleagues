import { beforeEach, describe, expect, it, vi } from "vitest";

import { espnFetch, espnFetchRef } from "@/lib/espn/shared/client";
import { fetchPhases } from "./phases";

vi.mock("@/lib/espn/shared/client", () => ({
  ESPN_SEASON_TYPES: { PRESEASON: 1, REGULAR: 2, POSTSEASON: 3, OFFSEASON: 4 },
  espnFetch: vi.fn(),
  espnFetchRef: vi.fn(),
  nflWeeksUrl: vi.fn().mockReturnValue("https://espn.test/weeks"),
}));

describe("fetchPhases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps regular and postseason weeks with correct seasonType", async () => {
    vi.mocked(espnFetch)
      .mockResolvedValueOnce({
        items: [{ $ref: "https://espn.test/week/reg-1" }],
        count: 1,
      })
      .mockResolvedValueOnce({
        items: [{ $ref: "https://espn.test/week/post-1" }],
        count: 1,
      });

    vi.mocked(espnFetchRef)
      .mockResolvedValueOnce({
        number: 1,
        text: "Week 1",
        startDate: "2025-09-04T00:00:00Z",
        endDate: "2025-09-10T00:00:00Z",
      })
      .mockResolvedValueOnce({
        number: 1,
        text: "Wild Card",
        startDate: "2026-01-10T00:00:00Z",
        endDate: "2026-01-13T00:00:00Z",
      });

    const phases = await fetchPhases(2025);

    expect(phases).toHaveLength(2);
    expect(phases[0]).toMatchObject({
      weekNumber: 1,
      label: "Week 1",
      seasonType: "regular",
      espnTypeId: 2,
    });
    expect(phases[1]).toMatchObject({
      weekNumber: 1,
      label: "Wild Card",
      seasonType: "postseason",
      espnTypeId: 3,
    });
  });

  it("filters out Pro Bowl and Pro Bowl Skills weeks", async () => {
    vi.mocked(espnFetch)
      .mockResolvedValueOnce({ items: [], count: 0 })
      .mockResolvedValueOnce({
        items: [
          { $ref: "https://espn.test/week/post-1" },
          { $ref: "https://espn.test/week/post-2" },
          { $ref: "https://espn.test/week/post-3" },
        ],
        count: 3,
      });

    vi.mocked(espnFetchRef)
      .mockResolvedValueOnce({
        number: 1,
        text: "Wild Card",
        startDate: "2026-01-10T00:00:00Z",
        endDate: "2026-01-13T00:00:00Z",
      })
      .mockResolvedValueOnce({
        number: 2,
        text: "Pro Bowl",
        startDate: "2026-01-25T00:00:00Z",
        endDate: "2026-01-27T00:00:00Z",
      })
      .mockResolvedValueOnce({
        number: 3,
        text: "Pro Bowl Skills Challenge",
        startDate: "2026-01-25T00:00:00Z",
        endDate: "2026-01-27T00:00:00Z",
      });

    const phases = await fetchPhases(2025);

    expect(phases.map((p) => p.label)).toEqual(["Wild Card"]);
  });

  it("sorts phases by season type then week number", async () => {
    vi.mocked(espnFetch)
      .mockResolvedValueOnce({
        items: [
          { $ref: "https://espn.test/reg-2" },
          { $ref: "https://espn.test/reg-1" },
        ],
        count: 2,
      })
      .mockResolvedValueOnce({
        items: [{ $ref: "https://espn.test/post-1" }],
        count: 1,
      });

    vi.mocked(espnFetchRef)
      .mockResolvedValueOnce({
        number: 2,
        text: "Week 2",
        startDate: "2025-09-11T00:00:00Z",
        endDate: "2025-09-17T00:00:00Z",
      })
      .mockResolvedValueOnce({
        number: 1,
        text: "Week 1",
        startDate: "2025-09-04T00:00:00Z",
        endDate: "2025-09-10T00:00:00Z",
      })
      .mockResolvedValueOnce({
        number: 1,
        text: "Wild Card",
        startDate: "2026-01-10T00:00:00Z",
        endDate: "2026-01-13T00:00:00Z",
      });

    const phases = await fetchPhases(2025);

    expect(phases.map((p) => p.label)).toEqual([
      "Week 1",
      "Week 2",
      "Wild Card",
    ]);
  });
});
