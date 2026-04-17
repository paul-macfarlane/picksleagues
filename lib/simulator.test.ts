import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeasonEventSummary } from "@/data/events";
import type { SimulatorState } from "@/lib/db/schema/simulator";
import type { Phase, Season } from "@/lib/db/schema/sports";
import { BadRequestError, NotFoundError } from "@/lib/errors";

import {
  advancePhase,
  getAppNow,
  getStatus,
  initializeSeason,
  isValidSimulatorYear,
  resetSeason,
} from "./simulator";

// --- Mocks ---

vi.mock("@/data/simulator", () => ({
  getSimulatorState: vi.fn(),
  upsertSimulatorState: vi.fn(),
  clearSimulatorState: vi.fn(),
}));

vi.mock("@/data/sports", () => ({
  getDataSourceByName: vi.fn(),
  getSportsLeagueByAbbreviation: vi.fn(),
}));

vi.mock("@/data/seasons", () => ({
  getSeasonByLeagueAndYear: vi.fn(),
  removeSeason: vi.fn(),
}));

vi.mock("@/data/phases", () => ({
  getPhasesBySeason: vi.fn(),
}));

vi.mock("@/data/events", () => ({
  getScorableEventsForPhase: vi.fn(),
  getEventsBySeason: vi.fn(),
  updateEvent: vi.fn(),
  getLockedEventIds: vi.fn().mockResolvedValue(new Set<string>()),
}));

vi.mock("@/lib/sync/nfl/setup", () => ({
  runInitialSetup: vi.fn(),
}));

vi.mock("@/lib/espn/nfl/scores", () => ({
  fetchEventScore: vi.fn(),
}));

const { getSimulatorState, upsertSimulatorState, clearSimulatorState } =
  await import("@/data/simulator");
const { getDataSourceByName, getSportsLeagueByAbbreviation } =
  await import("@/data/sports");
const { getSeasonByLeagueAndYear, removeSeason } =
  await import("@/data/seasons");
const { getPhasesBySeason } = await import("@/data/phases");
const {
  getScorableEventsForPhase,
  getEventsBySeason,
  updateEvent,
  getLockedEventIds,
} = await import("@/data/events");
const { runInitialSetup } = await import("@/lib/sync/nfl/setup");
const { fetchEventScore } = await import("@/lib/espn/nfl/scores");

const mockGetSimulatorState = vi.mocked(getSimulatorState);
const mockUpsertSimulatorState = vi.mocked(upsertSimulatorState);
const mockClearSimulatorState = vi.mocked(clearSimulatorState);
const mockGetDataSourceByName = vi.mocked(getDataSourceByName);
const mockGetSportsLeagueByAbbreviation = vi.mocked(
  getSportsLeagueByAbbreviation,
);
const mockGetSeasonByLeagueAndYear = vi.mocked(getSeasonByLeagueAndYear);
const mockRemoveSeason = vi.mocked(removeSeason);
const mockGetPhasesBySeason = vi.mocked(getPhasesBySeason);
const mockGetScorableEventsForPhase = vi.mocked(getScorableEventsForPhase);
const mockGetEventsBySeason = vi.mocked(getEventsBySeason);
const mockUpdateEvent = vi.mocked(updateEvent);
const mockGetLockedEventIds = vi.mocked(getLockedEventIds);
const mockRunInitialSetup = vi.mocked(runInitialSetup);
const mockFetchEventScore = vi.mocked(fetchEventScore);

// --- Fixtures ---

const NOW = new Date("2026-04-16T12:00:00Z");

const PHASE_1: Phase = {
  id: "phase-1",
  seasonId: "season-1",
  seasonType: "regular",
  weekNumber: 1,
  label: "Week 1",
  startDate: new Date("2023-09-05T06:00:00Z"),
  endDate: new Date("2023-09-12T06:00:00Z"),
  pickLockTime: new Date("2023-09-10T17:00:00Z"),
  lockedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const PHASE_2: Phase = {
  id: "phase-2",
  seasonId: "season-1",
  seasonType: "regular",
  weekNumber: 2,
  label: "Week 2",
  startDate: new Date("2023-09-12T06:00:00Z"),
  endDate: new Date("2023-09-19T06:00:00Z"),
  pickLockTime: new Date("2023-09-17T17:00:00Z"),
  lockedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const PHASE_3_CONTIGUOUS: Phase = {
  ...PHASE_2,
  id: "phase-3",
  weekNumber: 3,
  label: "Week 3",
  startDate: new Date("2023-09-19T06:00:00Z"),
  endDate: new Date("2023-09-26T06:00:00Z"),
};

const PHASE_3_WITH_GAP: Phase = {
  ...PHASE_2,
  id: "phase-3",
  weekNumber: 3,
  label: "Week 3",
  startDate: new Date("2023-09-26T06:00:00Z"),
  endDate: new Date("2023-10-03T06:00:00Z"),
};

const SEASON: Season = {
  id: "season-1",
  sportsLeagueId: "sl-1",
  year: 2023,
  startDate: new Date("2023-08-01"),
  endDate: new Date("2024-02-15"),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const NFL_LEAGUE = {
  id: "sl-1",
  name: "National Football League",
  abbreviation: "NFL",
  sport: "football",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ESPN_SOURCE = {
  id: "ds-1",
  name: "ESPN",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeState(overrides?: Partial<SimulatorState>): SimulatorState {
  return {
    id: "ss-1",
    singleton: 1,
    seasonYear: 2023,
    simNow: new Date("2023-09-05T06:00:00.001Z"),
    initialized: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSportsLeagueByAbbreviation.mockResolvedValue(NFL_LEAGUE);
  mockGetDataSourceByName.mockResolvedValue(ESPN_SOURCE);
  mockGetSeasonByLeagueAndYear.mockResolvedValue(SEASON);
  mockGetPhasesBySeason.mockResolvedValue([PHASE_1, PHASE_2]);
  mockGetEventsBySeason.mockResolvedValue([]);
  mockGetLockedEventIds.mockResolvedValue(new Set<string>());
});

// --- Tests ---

describe("isValidSimulatorYear", () => {
  const referenceNow = new Date("2026-04-16T00:00:00Z");

  it("accepts current year", () => {
    expect(isValidSimulatorYear(2026, referenceNow)).toBe(true);
  });

  it("accepts year 5 back", () => {
    expect(isValidSimulatorYear(2021, referenceNow)).toBe(true);
  });

  it("rejects year 6 back", () => {
    expect(isValidSimulatorYear(2020, referenceNow)).toBe(false);
  });

  it("rejects future years", () => {
    expect(isValidSimulatorYear(2027, referenceNow)).toBe(false);
  });

  it("rejects non-integer years", () => {
    expect(isValidSimulatorYear(2023.5, referenceNow)).toBe(false);
  });
});

describe("getAppNow", () => {
  it("returns simNow when simulator is initialized", async () => {
    const simNow = new Date("2023-09-15T00:00:00Z");
    mockGetSimulatorState.mockResolvedValue(makeState({ simNow }));

    const result = await getAppNow();

    expect(result).toEqual(simNow);
  });

  it("returns real now when simulator state is missing", async () => {
    mockGetSimulatorState.mockResolvedValue(null);

    const before = Date.now();
    const result = await getAppNow();
    const after = Date.now();

    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });

  it("returns real now when simulator state exists but uninitialized", async () => {
    mockGetSimulatorState.mockResolvedValue(makeState({ initialized: false }));

    const before = Date.now();
    const result = await getAppNow();
    const after = Date.now();

    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("initializeSeason", () => {
  beforeEach(() => {
    // Default: no prior state (fresh install)
    mockGetSimulatorState.mockResolvedValue(null);
    mockRunInitialSetup.mockResolvedValue({
      seasonYear: 2023,
      phasesUpserted: 18,
      phasesLocked: 0,
      teamsInserted: 32,
      teamsUpdated: 0,
      teamsLocked: 0,
      eventsInserted: 272,
      eventsUpdated: 0,
      eventsSkipped: 0,
      eventsLocked: 0,
      oddsUpserted: 272,
      oddsEmpty: 0,
      oddsLocked: 0,
    });
  });

  it("rejects an out-of-range year", async () => {
    await expect(initializeSeason(2019, NOW)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(mockRunInitialSetup).not.toHaveBeenCalled();
  });

  it("resets prior state before setting up a new year", async () => {
    const priorState = makeState({ seasonYear: 2022 });
    const priorSeason = { ...SEASON, year: 2022 };
    mockGetSimulatorState.mockResolvedValueOnce(priorState).mockResolvedValue(
      makeState({
        seasonYear: 2023,
        simNow: new Date(PHASE_1.startDate.getTime() + 1),
      }),
    );
    mockGetSeasonByLeagueAndYear
      .mockResolvedValueOnce(priorSeason)
      .mockResolvedValue(SEASON);

    await initializeSeason(2023, NOW);

    expect(mockRemoveSeason).toHaveBeenCalledWith(priorSeason.id);
    expect(mockClearSimulatorState).toHaveBeenCalled();
  });

  it("passes Sept 15 of target year to runInitialSetup", async () => {
    mockGetSimulatorState.mockResolvedValueOnce(null).mockResolvedValue(
      makeState({
        seasonYear: 2023,
        simNow: new Date(PHASE_1.startDate.getTime() + 1),
      }),
    );

    await initializeSeason(2023, NOW);

    expect(mockRunInitialSetup).toHaveBeenCalledWith(
      new Date(Date.UTC(2023, 8, 15)),
    );
  });

  it("sets simNow to 1ms past first phase start", async () => {
    mockGetSimulatorState.mockResolvedValueOnce(null).mockResolvedValue(
      makeState({
        seasonYear: 2023,
        simNow: new Date(PHASE_1.startDate.getTime() + 1),
      }),
    );

    await initializeSeason(2023, NOW);

    expect(mockUpsertSimulatorState).toHaveBeenCalledWith({
      seasonYear: 2023,
      simNow: new Date(PHASE_1.startDate.getTime() + 1),
      initialized: true,
    });
  });

  it("throws when no phases were synced", async () => {
    mockGetPhasesBySeason.mockResolvedValue([]);

    await expect(initializeSeason(2023, NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws when season is missing after setup", async () => {
    mockGetSeasonByLeagueAndYear.mockResolvedValue(null);

    await expect(initializeSeason(2023, NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("advancePhase", () => {
  const scorableEvents = [
    {
      eventId: "event-1",
      status: "not_started" as const,
      startTime: new Date("2023-09-10T17:00:00Z"),
      statusRef: "https://espn/status/1",
      homeScoreRef: "https://espn/score/home/1",
      awayScoreRef: "https://espn/score/away/1",
    },
    {
      eventId: "event-2",
      status: "not_started" as const,
      startTime: new Date("2023-09-10T20:00:00Z"),
      statusRef: "https://espn/status/2",
      homeScoreRef: "https://espn/score/home/2",
      awayScoreRef: "https://espn/score/away/2",
    },
  ];

  beforeEach(() => {
    mockGetScorableEventsForPhase.mockResolvedValue(scorableEvents);
    mockFetchEventScore.mockResolvedValue({
      status: "final",
      homeScore: 24,
      awayScore: 17,
      period: null,
      clock: null,
    });
  });

  it("throws when simulator is not initialized", async () => {
    mockGetSimulatorState.mockResolvedValue(null);

    await expect(advancePhase()).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws when no phase is active for current simNow", async () => {
    mockGetSimulatorState.mockResolvedValue(
      makeState({ simNow: new Date("2022-01-01T00:00:00Z") }),
    );

    await expect(advancePhase()).rejects.toBeInstanceOf(BadRequestError);
  });

  it("finalizes every scorable event in the current phase", async () => {
    mockGetSimulatorState.mockResolvedValue(
      makeState({ simNow: new Date(PHASE_1.startDate.getTime() + 1) }),
    );

    await advancePhase();

    expect(mockGetScorableEventsForPhase).toHaveBeenCalledWith(
      PHASE_1.id,
      ESPN_SOURCE.id,
    );
    expect(mockUpdateEvent).toHaveBeenCalledTimes(2);
    expect(mockUpdateEvent).toHaveBeenCalledWith("event-1", {
      status: "final",
      homeScore: 24,
      awayScore: 17,
    });
  });

  it("skips locked events when advancing", async () => {
    mockGetSimulatorState.mockResolvedValue(
      makeState({ simNow: new Date(PHASE_1.startDate.getTime() + 1) }),
    );
    mockGetLockedEventIds.mockResolvedValue(new Set(["event-1"]));

    await advancePhase();

    expect(mockUpdateEvent).toHaveBeenCalledTimes(1);
    expect(mockUpdateEvent).toHaveBeenCalledWith("event-2", expect.anything());
    expect(mockFetchEventScore).toHaveBeenCalledTimes(1);
  });

  it("advances simNow to 1ms past next phase start (contiguous)", async () => {
    mockGetSimulatorState.mockResolvedValue(
      makeState({ simNow: new Date(PHASE_1.startDate.getTime() + 1) }),
    );

    await advancePhase();

    // PHASE_2.startDate === PHASE_1.endDate (contiguous). Land inside PHASE_2.
    expect(mockUpsertSimulatorState).toHaveBeenCalledWith({
      seasonYear: 2023,
      simNow: new Date(PHASE_2.startDate.getTime() + 1),
      initialized: true,
    });
  });

  it("does not skip a phase when three phases are contiguous", async () => {
    // Regression for manual-test bug where advancing from phase 1 skipped
    // phase 2 and landed in phase 3. The fix walks the ordered phase list
    // by index so contiguous boundaries don't get dropped by a strict-greater
    // date comparison.
    mockGetPhasesBySeason.mockResolvedValue([
      PHASE_1,
      PHASE_2,
      PHASE_3_CONTIGUOUS,
    ]);
    mockGetSimulatorState.mockResolvedValue(
      makeState({ simNow: new Date(PHASE_1.startDate.getTime() + 1) }),
    );

    await advancePhase();

    expect(mockUpsertSimulatorState).toHaveBeenCalledWith({
      seasonYear: 2023,
      simNow: new Date(PHASE_2.startDate.getTime() + 1),
      initialized: true,
    });
  });

  it("jumps over a gap to the next phase's start", async () => {
    mockGetPhasesBySeason.mockResolvedValue([PHASE_1, PHASE_3_WITH_GAP]);
    mockGetSimulatorState.mockResolvedValue(
      makeState({ simNow: new Date(PHASE_1.startDate.getTime() + 1) }),
    );

    await advancePhase();

    expect(mockUpsertSimulatorState).toHaveBeenCalledWith({
      seasonYear: 2023,
      simNow: new Date(PHASE_3_WITH_GAP.startDate.getTime() + 1),
      initialized: true,
    });
  });

  it("advances past last phase when no next phase exists", async () => {
    mockGetPhasesBySeason.mockResolvedValue([PHASE_1]);
    mockGetSimulatorState.mockResolvedValue(
      makeState({ simNow: new Date(PHASE_1.startDate.getTime() + 1) }),
    );

    await advancePhase();

    expect(mockUpsertSimulatorState).toHaveBeenCalledWith({
      seasonYear: 2023,
      simNow: new Date(PHASE_1.endDate.getTime() + 1),
      initialized: true,
    });
  });
});

describe("getStatus", () => {
  it("returns uninitialized when no state", async () => {
    mockGetSimulatorState.mockResolvedValue(null);

    const result = await getStatus();

    expect(result).toEqual({
      initialized: false,
      seasonYear: null,
      simNow: null,
      currentPhase: null,
      totalPhases: 0,
      totalEvents: 0,
      finalizedEvents: 0,
    });
  });

  it("returns empty-with-state when NFL league is missing", async () => {
    mockGetSimulatorState.mockResolvedValue(makeState());
    mockGetSportsLeagueByAbbreviation.mockRejectedValue(
      new NotFoundError("not found"),
    );

    const result = await getStatus();

    expect(result.initialized).toBe(true);
    expect(result.totalPhases).toBe(0);
    expect(result.currentPhase).toBeNull();
  });

  it("reports current phase and event counts", async () => {
    const simNow = new Date(PHASE_1.startDate.getTime() + 1);
    mockGetSimulatorState.mockResolvedValue(makeState({ simNow }));
    const eventSummaries: SeasonEventSummary[] = [
      { id: "e1", phaseId: PHASE_1.id, status: "final" },
      { id: "e2", phaseId: PHASE_1.id, status: "not_started" },
      { id: "e3", phaseId: PHASE_2.id, status: "not_started" },
    ];
    mockGetEventsBySeason.mockResolvedValue(eventSummaries);

    const result = await getStatus();

    expect(result).toEqual({
      initialized: true,
      seasonYear: 2023,
      simNow,
      currentPhase: {
        id: PHASE_1.id,
        label: PHASE_1.label,
        startDate: PHASE_1.startDate,
        endDate: PHASE_1.endDate,
        eventsTotal: 2,
        eventsFinalized: 1,
      },
      totalPhases: 2,
      totalEvents: 3,
      finalizedEvents: 1,
    });
  });
});

describe("resetSeason", () => {
  it("is a no-op when no state exists", async () => {
    mockGetSimulatorState.mockResolvedValue(null);

    await resetSeason();

    expect(mockRemoveSeason).not.toHaveBeenCalled();
    expect(mockClearSimulatorState).not.toHaveBeenCalled();
  });

  it("removes the simulated year's season and clears state", async () => {
    mockGetSimulatorState.mockResolvedValue(makeState());

    await resetSeason();

    expect(mockRemoveSeason).toHaveBeenCalledWith(SEASON.id);
    expect(mockClearSimulatorState).toHaveBeenCalled();
  });

  it("clears state even when NFL league is missing", async () => {
    mockGetSimulatorState.mockResolvedValue(makeState());
    mockGetSportsLeagueByAbbreviation.mockRejectedValue(
      new NotFoundError("not found"),
    );

    await resetSeason();

    expect(mockRemoveSeason).not.toHaveBeenCalled();
    expect(mockClearSimulatorState).toHaveBeenCalled();
  });

  it("clears state when season doesn't exist (orphaned)", async () => {
    mockGetSimulatorState.mockResolvedValue(makeState());
    mockGetSeasonByLeagueAndYear.mockResolvedValue(null);

    await resetSeason();

    expect(mockRemoveSeason).not.toHaveBeenCalled();
    expect(mockClearSimulatorState).toHaveBeenCalled();
  });
});
