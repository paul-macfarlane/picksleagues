import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScorableEvent } from "@/data/events";
import type { FetchedEventScore } from "@/lib/espn/nfl/scores";

import { runLiveScoresSync } from "./live-scores";

vi.mock("@/data/events", () => ({
  getScorableEvents: vi.fn(),
  updateEvent: vi.fn(),
  getLockedEventIds: vi.fn().mockResolvedValue(new Set<string>()),
}));

vi.mock("@/data/sports", () => ({
  getDataSourceByName: vi.fn().mockResolvedValue({ id: "ds-1", name: "ESPN" }),
}));

vi.mock("@/lib/espn/nfl/scores", () => ({
  fetchEventScore: vi.fn(),
}));

vi.mock("@/lib/nfl/scheduling", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/nfl/scheduling")>();
  return {
    ...original,
    isNflSeasonMonth: vi.fn(),
    isGameWindowActive: vi.fn(),
  };
});

vi.mock("@/lib/sync/nfl/standings", () => ({
  runStandingsRecalc: vi
    .fn()
    .mockResolvedValue({ leaguesAffected: 0, picksRescored: 0 }),
}));

const { getScorableEvents, updateEvent, getLockedEventIds } =
  await import("@/data/events");
const { fetchEventScore } = await import("@/lib/espn/nfl/scores");
const { isNflSeasonMonth, isGameWindowActive } =
  await import("@/lib/nfl/scheduling");
const { runStandingsRecalc } = await import("@/lib/sync/nfl/standings");

const mockGetScorableEvents = vi.mocked(getScorableEvents);
const mockUpdateEvent = vi.mocked(updateEvent);
const mockGetLockedEventIds = vi.mocked(getLockedEventIds);
const mockFetchEventScore = vi.mocked(fetchEventScore);
const mockIsNflSeasonMonth = vi.mocked(isNflSeasonMonth);
const mockIsGameWindowActive = vi.mocked(isGameWindowActive);

const OCTOBER_SUNDAY = new Date("2025-10-12T18:00:00Z");

function makeScorableEvent(overrides?: Partial<ScorableEvent>): ScorableEvent {
  return {
    eventId: "event-1",
    status: "not_started",
    startTime: new Date("2025-10-12T17:00:00Z"),
    statusRef: "https://espn.com/status/1",
    homeScoreRef: "https://espn.com/score/home/1",
    awayScoreRef: "https://espn.com/score/away/1",
    ...overrides,
  };
}

function makeScore(overrides?: Partial<FetchedEventScore>): FetchedEventScore {
  return {
    status: "in_progress",
    homeScore: 14,
    awayScore: 7,
    period: 2,
    clock: "8:42",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNflSeasonMonth.mockReturnValue(true);
  mockIsGameWindowActive.mockReturnValue(true);
  mockGetScorableEvents.mockResolvedValue([]);
  mockGetLockedEventIds.mockResolvedValue(new Set<string>());
});

describe("runLiveScoresSync", () => {
  it("skips when off-season", async () => {
    mockIsNflSeasonMonth.mockReturnValue(false);

    const result = await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("off-season");
    expect(mockGetScorableEvents).not.toHaveBeenCalled();
    expect(mockFetchEventScore).not.toHaveBeenCalled();
  });

  it("skips when no scorable events", async () => {
    mockGetScorableEvents.mockResolvedValue([]);

    const result = await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no-scorable-events");
    expect(mockFetchEventScore).not.toHaveBeenCalled();
  });

  it("skips when no active game window", async () => {
    mockGetScorableEvents.mockResolvedValue([makeScorableEvent()]);
    mockIsGameWindowActive.mockReturnValue(false);

    const result = await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no-game-window");
    expect(mockFetchEventScore).not.toHaveBeenCalled();
  });

  it("updates events with fetched scores", async () => {
    const event = makeScorableEvent({ eventId: "event-1" });
    const score = makeScore({
      status: "in_progress",
      homeScore: 21,
      awayScore: 14,
    });

    mockGetScorableEvents.mockResolvedValue([event]);
    mockFetchEventScore.mockResolvedValue(score);

    const result = await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(false);
    expect(result.eventsUpdated).toBe(1);
    expect(result.eventsFinalized).toBe(0);
    expect(mockUpdateEvent).toHaveBeenCalledWith("event-1", {
      status: "in_progress",
      homeScore: 21,
      awayScore: 14,
    });
  });

  it("counts finalized events when status becomes final", async () => {
    const event = makeScorableEvent({
      eventId: "event-2",
      status: "in_progress",
    });
    const score = makeScore({
      status: "final",
      homeScore: 28,
      awayScore: 24,
      period: null,
      clock: null,
    });

    mockGetScorableEvents.mockResolvedValue([event]);
    mockFetchEventScore.mockResolvedValue(score);

    const result = await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(result.eventsFinalized).toBe(1);
    expect(mockUpdateEvent).toHaveBeenCalledWith("event-2", {
      status: "final",
      homeScore: 28,
      awayScore: 24,
    });
    // §8.5: when any event finalizes, the live-scores sync must kick the
    // standings recalc so scored picks flow into leaderboards.
    expect(runStandingsRecalc).toHaveBeenCalledTimes(1);
  });

  it("handles mixed results — some final, some in-progress", async () => {
    const events = [
      makeScorableEvent({ eventId: "e-1", status: "in_progress" }),
      makeScorableEvent({ eventId: "e-2", status: "in_progress" }),
      makeScorableEvent({ eventId: "e-3" }),
    ];

    mockGetScorableEvents.mockResolvedValue(events);
    mockFetchEventScore
      .mockResolvedValueOnce(
        makeScore({ status: "final", homeScore: 31, awayScore: 17 }),
      )
      .mockResolvedValueOnce(
        makeScore({ status: "in_progress", homeScore: 10, awayScore: 10 }),
      )
      .mockResolvedValueOnce(
        makeScore({ status: "not_started", homeScore: 0, awayScore: 0 }),
      );

    const result = await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(false);
    expect(result.eventsUpdated).toBe(3);
    expect(result.eventsFinalized).toBe(1);
    expect(mockUpdateEvent).toHaveBeenCalledTimes(3);
  });

  it("does not recalc standings when nothing finalized", async () => {
    const event = makeScorableEvent({
      eventId: "event-3",
      status: "in_progress",
    });
    mockGetScorableEvents.mockResolvedValue([event]);
    mockFetchEventScore.mockResolvedValue(
      makeScore({ status: "in_progress", homeScore: 10, awayScore: 7 }),
    );

    const result = await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(result.eventsFinalized).toBe(0);
    expect(runStandingsRecalc).not.toHaveBeenCalled();
  });

  it("passes correct ESPN refs to fetchEventScore", async () => {
    const event = makeScorableEvent({
      statusRef: "https://espn.com/status/42",
      homeScoreRef: "https://espn.com/score/home/42",
      awayScoreRef: "https://espn.com/score/away/42",
    });

    mockGetScorableEvents.mockResolvedValue([event]);
    mockFetchEventScore.mockResolvedValue(makeScore());

    await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(mockFetchEventScore).toHaveBeenCalledWith({
      statusRef: "https://espn.com/status/42",
      homeScoreRef: "https://espn.com/score/home/42",
      awayScoreRef: "https://espn.com/score/away/42",
    });
  });

  it("skips locked events and counts them", async () => {
    mockGetScorableEvents.mockResolvedValue([
      makeScorableEvent({ eventId: "event-free" }),
      makeScorableEvent({ eventId: "event-locked" }),
    ]);
    mockGetLockedEventIds.mockResolvedValue(new Set(["event-locked"]));
    mockFetchEventScore.mockResolvedValue(makeScore());

    const result = await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(false);
    expect(result.eventsLocked).toBe(1);
    expect(result.eventsUpdated).toBe(1);
    expect(mockUpdateEvent).toHaveBeenCalledTimes(1);
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      "event-free",
      expect.anything(),
    );
    expect(mockFetchEventScore).toHaveBeenCalledTimes(1);
  });

  it("skips when every scorable event is locked", async () => {
    mockGetScorableEvents.mockResolvedValue([
      makeScorableEvent({ eventId: "event-locked" }),
    ]);
    mockGetLockedEventIds.mockResolvedValue(new Set(["event-locked"]));

    const result = await runLiveScoresSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("all-locked");
    expect(result.eventsLocked).toBe(1);
    expect(mockFetchEventScore).not.toHaveBeenCalled();
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });
});
