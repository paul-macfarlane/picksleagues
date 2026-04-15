import { beforeEach, describe, expect, it, vi } from "vitest";

import { espnFetch, espnFetchRef } from "@/lib/espn/shared/client";
import { fetchEvents } from "./events";

vi.mock("@/lib/espn/shared/client", () => ({
  espnFetch: vi.fn(),
  espnFetchRef: vi.fn(),
  nflEventsUrl: vi.fn().mockReturnValue("https://espn.test/events"),
}));

function eventRef(id: string) {
  return { $ref: `https://espn.test/event/${id}` };
}

describe("fetchEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts home/away team espn IDs and $refs", async () => {
    vi.mocked(espnFetch).mockResolvedValue({
      items: [eventRef("1")],
      count: 1,
    });

    vi.mocked(espnFetchRef).mockResolvedValueOnce({
      id: "401234567",
      date: "2025-09-07T17:00:00Z",
      competitions: [
        {
          id: "comp-1",
          competitors: [
            {
              id: "team-home",
              homeAway: "home",
              team: { $ref: "https://espn.test/team/home" },
              score: { $ref: "https://espn.test/score/home" },
            },
            {
              id: "team-away",
              homeAway: "away",
              team: { $ref: "https://espn.test/team/away" },
              score: { $ref: "https://espn.test/score/away" },
            },
          ],
          odds: { $ref: "https://espn.test/odds/1" },
          status: { $ref: "https://espn.test/status/1" },
        },
      ],
    });

    const [event] = await fetchEvents(2025, 2, 1);

    expect(event).toEqual({
      espnId: "401234567",
      startTime: new Date("2025-09-07T17:00:00Z"),
      homeTeamEspnId: "team-home",
      awayTeamEspnId: "team-away",
      refs: {
        oddsRef: "https://espn.test/odds/1",
        statusRef: "https://espn.test/status/1",
        homeScoreRef: "https://espn.test/score/home",
        awayScoreRef: "https://espn.test/score/away",
      },
    });
  });

  it("skips events missing either home or away competitor", async () => {
    vi.mocked(espnFetch).mockResolvedValue({
      items: [eventRef("1")],
      count: 1,
    });

    vi.mocked(espnFetchRef).mockResolvedValueOnce({
      id: "401234567",
      date: "2025-09-07T17:00:00Z",
      competitions: [
        {
          id: "comp-1",
          competitors: [
            {
              id: "team-home",
              homeAway: "home",
              team: { $ref: "https://espn.test/team/home" },
            },
          ],
        },
      ],
    });

    const events = await fetchEvents(2025, 2, 1);

    expect(events).toEqual([]);
  });

  it("returns nulls when odds/status/score refs are absent", async () => {
    vi.mocked(espnFetch).mockResolvedValue({
      items: [eventRef("1")],
      count: 1,
    });

    vi.mocked(espnFetchRef).mockResolvedValueOnce({
      id: "401234567",
      date: "2025-09-07T17:00:00Z",
      competitions: [
        {
          id: "comp-1",
          competitors: [
            {
              id: "team-home",
              homeAway: "home",
              team: { $ref: "https://espn.test/team/home" },
            },
            {
              id: "team-away",
              homeAway: "away",
              team: { $ref: "https://espn.test/team/away" },
            },
          ],
        },
      ],
    });

    const [event] = await fetchEvents(2025, 2, 1);

    expect(event.refs).toEqual({
      oddsRef: null,
      statusRef: null,
      homeScoreRef: null,
      awayScoreRef: null,
    });
  });
});
