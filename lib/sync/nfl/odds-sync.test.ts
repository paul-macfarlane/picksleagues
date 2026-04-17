import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OddsSyncableEvent } from "@/data/events";
import type { FetchedOdds } from "@/lib/espn/nfl/odds";

import { runOddsSync } from "./odds-sync";

vi.mock("@/data/events", () => ({
  getOddsSyncableEvents: vi.fn(),
  upsertOdds: vi.fn(),
  getLockedOddsPairs: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/data/sports", () => ({
  getDataSourceByName: vi.fn().mockResolvedValue({ id: "ds-1", name: "ESPN" }),
  getSportsbookByName: vi
    .fn()
    .mockResolvedValue({ id: "sb-1", name: "ESPN Bet" }),
}));

vi.mock("@/lib/espn/nfl/odds", () => ({
  fetchOdds: vi.fn(),
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

const { getOddsSyncableEvents, upsertOdds, getLockedOddsPairs } =
  await import("@/data/events");
const { fetchOdds } = await import("@/lib/espn/nfl/odds");
const { isNflSeasonMonth, isGameWindowActive } =
  await import("@/lib/nfl/scheduling");

const mockGetOddsSyncableEvents = vi.mocked(getOddsSyncableEvents);
const mockUpsertOdds = vi.mocked(upsertOdds);
const mockFetchOdds = vi.mocked(fetchOdds);
const mockGetLockedOddsPairs = vi.mocked(getLockedOddsPairs);
const mockIsNflSeasonMonth = vi.mocked(isNflSeasonMonth);
const mockIsGameWindowActive = vi.mocked(isGameWindowActive);

const OCTOBER_SUNDAY = new Date("2025-10-12T18:00:00Z");

function makeSyncableEvent(
  overrides?: Partial<OddsSyncableEvent>,
): OddsSyncableEvent {
  return {
    eventId: "event-1",
    startTime: new Date("2025-10-12T17:00:00Z"),
    oddsRef: "https://espn.com/odds/1",
    ...overrides,
  };
}

function makeFetchedOdds(overrides?: Partial<FetchedOdds>): FetchedOdds {
  return {
    providerId: "provider-1",
    providerName: "ESPN Bet",
    homeSpread: -3.5,
    awaySpread: 3.5,
    homeMoneyline: -180,
    awayMoneyline: 150,
    overUnder: 45.5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNflSeasonMonth.mockReturnValue(true);
  mockIsGameWindowActive.mockReturnValue(true);
  mockGetOddsSyncableEvents.mockResolvedValue([]);
  mockGetLockedOddsPairs.mockResolvedValue([]);
});

describe("runOddsSync", () => {
  it("skips when off-season", async () => {
    mockIsNflSeasonMonth.mockReturnValue(false);

    const result = await runOddsSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("off-season");
    expect(mockGetOddsSyncableEvents).not.toHaveBeenCalled();
    expect(mockFetchOdds).not.toHaveBeenCalled();
  });

  it("skips when no syncable events", async () => {
    mockGetOddsSyncableEvents.mockResolvedValue([]);

    const result = await runOddsSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no-syncable-events");
    expect(mockFetchOdds).not.toHaveBeenCalled();
  });

  it("skips when no active game window", async () => {
    mockGetOddsSyncableEvents.mockResolvedValue([makeSyncableEvent()]);
    mockIsGameWindowActive.mockReturnValue(false);

    const result = await runOddsSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no-game-window");
    expect(mockFetchOdds).not.toHaveBeenCalled();
  });

  it("updates odds for syncable events", async () => {
    const event = makeSyncableEvent({ eventId: "event-1" });
    const odds = makeFetchedOdds({
      homeSpread: -7,
      awaySpread: 7,
      homeMoneyline: -300,
      awayMoneyline: 240,
      overUnder: 48.5,
    });

    mockGetOddsSyncableEvents.mockResolvedValue([event]);
    mockFetchOdds.mockResolvedValue(odds);

    const result = await runOddsSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(false);
    expect(result.oddsUpdated).toBe(1);
    expect(result.oddsEmpty).toBe(0);
    expect(mockUpsertOdds).toHaveBeenCalledWith({
      eventId: "event-1",
      sportsbookId: "sb-1",
      homeSpread: -7,
      awaySpread: 7,
      homeMoneyline: -300,
      awayMoneyline: 240,
      overUnder: 48.5,
    });
  });

  it("handles empty odds (no provider data)", async () => {
    mockGetOddsSyncableEvents.mockResolvedValue([makeSyncableEvent()]);
    mockFetchOdds.mockResolvedValue(null);

    const result = await runOddsSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(false);
    expect(result.oddsUpdated).toBe(0);
    expect(result.oddsEmpty).toBe(1);
    expect(mockUpsertOdds).not.toHaveBeenCalled();
  });

  it("handles mixed results — some with odds, some empty", async () => {
    const events = [
      makeSyncableEvent({ eventId: "e-1" }),
      makeSyncableEvent({ eventId: "e-2" }),
      makeSyncableEvent({ eventId: "e-3" }),
    ];

    mockGetOddsSyncableEvents.mockResolvedValue(events);
    mockFetchOdds
      .mockResolvedValueOnce(makeFetchedOdds())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeFetchedOdds());

    const result = await runOddsSync(OCTOBER_SUNDAY);

    expect(result.skipped).toBe(false);
    expect(result.oddsUpdated).toBe(2);
    expect(result.oddsEmpty).toBe(1);
    expect(mockUpsertOdds).toHaveBeenCalledTimes(2);
  });

  it("passes correct oddsRef to fetchOdds", async () => {
    const event = makeSyncableEvent({
      oddsRef: "https://espn.com/odds/42",
    });

    mockGetOddsSyncableEvents.mockResolvedValue([event]);
    mockFetchOdds.mockResolvedValue(makeFetchedOdds());

    await runOddsSync(OCTOBER_SUNDAY);

    expect(mockFetchOdds).toHaveBeenCalledWith("https://espn.com/odds/42");
  });

  it("skips upsert for locked (event, sportsbook) pairs", async () => {
    mockGetOddsSyncableEvents.mockResolvedValue([
      makeSyncableEvent({ eventId: "event-locked" }),
      makeSyncableEvent({ eventId: "event-free" }),
    ]);
    mockFetchOdds.mockResolvedValue(makeFetchedOdds());
    mockGetLockedOddsPairs.mockResolvedValue([
      { eventId: "event-locked", sportsbookId: "sb-1" },
    ]);

    const result = await runOddsSync(OCTOBER_SUNDAY);

    expect(result.oddsLocked).toBe(1);
    expect(result.oddsUpdated).toBe(1);
    expect(mockUpsertOdds).toHaveBeenCalledTimes(1);
    expect(mockUpsertOdds).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-free" }),
    );
  });
});
