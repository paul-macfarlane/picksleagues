import { beforeEach, describe, expect, it, vi } from "vitest";

import { espnFetch } from "@/lib/espn/shared/client";
import { fetchEventScore } from "./scores";

vi.mock("@/lib/espn/shared/client", () => ({
  ESPN_GAME_STATUSES: {
    SCHEDULED: "STATUS_SCHEDULED",
    IN_PROGRESS: "STATUS_IN_PROGRESS",
    FINAL: "STATUS_FINAL",
    POSTPONED: "STATUS_POSTPONED",
  },
  espnFetch: vi.fn(),
}));

const refs = {
  statusRef: "https://espn.test/status",
  homeScoreRef: "https://espn.test/home",
  awayScoreRef: "https://espn.test/away",
};

describe("fetchEventScore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps STATUS_IN_PROGRESS to in_progress and includes period and clock", async () => {
    vi.mocked(espnFetch)
      .mockResolvedValueOnce({
        type: { name: "STATUS_IN_PROGRESS", completed: false },
        period: 2,
        displayClock: "7:23",
      })
      .mockResolvedValueOnce({ value: 14 })
      .mockResolvedValueOnce({ value: 10 });

    const result = await fetchEventScore(refs);

    expect(result).toEqual({
      status: "in_progress",
      homeScore: 14,
      awayScore: 10,
      period: 2,
      clock: "7:23",
    });
  });

  it("maps STATUS_FINAL to final with null period and clock", async () => {
    vi.mocked(espnFetch)
      .mockResolvedValueOnce({
        type: { name: "STATUS_FINAL", completed: true },
        period: 4,
        displayClock: "0:00",
      })
      .mockResolvedValueOnce({ value: 21 })
      .mockResolvedValueOnce({ value: 17 });

    const result = await fetchEventScore(refs);

    expect(result).toMatchObject({
      status: "final",
      period: null,
      clock: null,
    });
  });

  it("maps STATUS_SCHEDULED to not_started", async () => {
    vi.mocked(espnFetch)
      .mockResolvedValueOnce({
        type: { name: "STATUS_SCHEDULED", completed: false },
        period: 0,
        displayClock: "0:00",
      })
      .mockResolvedValueOnce({ value: 0 })
      .mockResolvedValueOnce({ value: 0 });

    const result = await fetchEventScore(refs);

    expect(result.status).toBe("not_started");
  });

  it("maps STATUS_POSTPONED (and unknown statuses) to not_started", async () => {
    vi.mocked(espnFetch)
      .mockResolvedValueOnce({
        type: { name: "STATUS_POSTPONED", completed: false },
        period: 0,
        displayClock: "0:00",
      })
      .mockResolvedValueOnce({ value: 0 })
      .mockResolvedValueOnce({ value: 0 });

    const result = await fetchEventScore(refs);

    expect(result.status).toBe("not_started");
  });
});
