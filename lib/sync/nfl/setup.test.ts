import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FetchedEvent } from "@/lib/espn/nfl/events";
import type { FetchedOdds } from "@/lib/espn/nfl/odds";
import type { FetchedPhase } from "@/lib/espn/nfl/phases";
import type { FetchedSeason } from "@/lib/espn/nfl/seasons";
import type { FetchedTeam } from "@/lib/espn/nfl/teams";

import { runInitialSetup } from "./setup";

// --- Mocks ---

vi.mock("@/data/sports", () => ({
  upsertDataSource: vi.fn().mockResolvedValue({ id: "ds-1", name: "ESPN" }),
  upsertSportsbook: vi.fn().mockResolvedValue({ id: "sb-1", name: "ESPN Bet" }),
  upsertSportsLeague: vi
    .fn()
    .mockResolvedValue({ id: "sl-1", abbreviation: "NFL" }),
}));

vi.mock("@/data/seasons", () => ({
  upsertSeason: vi.fn().mockResolvedValue({ id: "season-1" }),
}));

vi.mock("@/data/phases", () => ({
  upsertPhase: vi.fn().mockResolvedValue({ id: "phase-1" }),
  updatePhase: vi.fn().mockResolvedValue({ id: "phase-1" }),
}));

vi.mock("@/data/teams", () => ({
  insertTeam: vi.fn().mockResolvedValue({ id: "team-new" }),
  updateTeam: vi.fn().mockResolvedValue({ id: "team-existing" }),
}));

vi.mock("@/data/events", () => ({
  insertEvent: vi.fn().mockResolvedValue({ id: "event-1" }),
  updateEvent: vi.fn().mockResolvedValue({ id: "event-existing" }),
  upsertOdds: vi.fn().mockResolvedValue({ id: "odds-1" }),
}));

vi.mock("@/data/external", () => ({
  upsertExternalSeason: vi.fn().mockResolvedValue({}),
  upsertExternalPhase: vi.fn().mockResolvedValue({}),
  upsertExternalTeam: vi.fn().mockResolvedValue({}),
  upsertExternalEvent: vi.fn().mockResolvedValue({}),
  upsertExternalSportsbook: vi.fn().mockResolvedValue({ sportsbookId: "sb-1" }),
  getAllExternalTeams: vi.fn().mockResolvedValue([]),
  getAllExternalEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/espn/nfl/seasons", () => ({
  fetchCurrentSeason: vi.fn(),
}));

vi.mock("@/lib/espn/nfl/phases", () => ({
  fetchPhases: vi.fn(),
}));

vi.mock("@/lib/espn/nfl/teams", () => ({
  fetchTeams: vi.fn(),
}));

vi.mock("@/lib/espn/nfl/events", () => ({
  fetchEvents: vi.fn(),
}));

vi.mock("@/lib/espn/nfl/odds", () => ({
  fetchOdds: vi.fn(),
}));

vi.mock("@/lib/nfl/scheduling", () => ({
  calculatePickLockTime: vi
    .fn()
    .mockReturnValue(new Date("2025-09-14T17:00:00Z")),
  calculatePhaseStartBoundary: vi
    .fn()
    .mockReturnValue(new Date("2025-09-09T06:00:00Z")),
  calculatePhaseEndBoundary: vi
    .fn()
    .mockReturnValue(new Date("2025-09-16T06:00:00Z")),
}));

// --- Helpers to get mocked functions ---

const { upsertDataSource } = await import("@/data/sports");
const { upsertSeason } = await import("@/data/seasons");
const { upsertPhase, updatePhase } = await import("@/data/phases");
const { insertTeam, updateTeam } = await import("@/data/teams");
const { insertEvent, updateEvent, upsertOdds } = await import("@/data/events");
const {
  upsertExternalSeason,
  upsertExternalPhase,
  upsertExternalTeam,
  upsertExternalEvent,
  upsertExternalSportsbook,
  getAllExternalTeams,
  getAllExternalEvents,
} = await import("@/data/external");
const { fetchCurrentSeason } = await import("@/lib/espn/nfl/seasons");
const { fetchPhases } = await import("@/lib/espn/nfl/phases");
const { fetchTeams } = await import("@/lib/espn/nfl/teams");
const { fetchEvents } = await import("@/lib/espn/nfl/events");
const { fetchOdds } = await import("@/lib/espn/nfl/odds");
const { calculatePickLockTime } = await import("@/lib/nfl/scheduling");

// --- Test data ---

const SEASON: FetchedSeason = {
  year: 2025,
  startDate: new Date("2025-09-01"),
  endDate: new Date("2026-02-15"),
};

const PHASE: FetchedPhase = {
  weekNumber: 1,
  label: "Week 1",
  startDate: new Date("2025-09-09T00:00:00Z"),
  endDate: new Date("2025-09-16T00:00:00Z"),
  seasonType: "regular",
  espnTypeId: 2,
};

const TEAMS: FetchedTeam[] = [
  {
    espnId: "12",
    name: "Chiefs",
    location: "Kansas City",
    abbreviation: "KC",
    logoUrl: "https://example.com/kc.png",
    logoDarkUrl: "https://example.com/kc-dark.png",
  },
  {
    espnId: "33",
    name: "Ravens",
    location: "Baltimore",
    abbreviation: "BAL",
    logoUrl: "https://example.com/bal.png",
  },
];

const EVENT: FetchedEvent = {
  espnId: "401547417",
  startTime: new Date("2025-09-11T00:20:00Z"),
  homeTeamEspnId: "12",
  awayTeamEspnId: "33",
  refs: {
    oddsRef: "https://sports.core.api.espn.com/v2/odds/123",
    statusRef: "https://sports.core.api.espn.com/v2/status/123",
    homeScoreRef: "https://sports.core.api.espn.com/v2/score/12",
    awayScoreRef: "https://sports.core.api.espn.com/v2/score/33",
  },
};

const ODDS: FetchedOdds = {
  providerId: "1002",
  providerName: "ESPN Bet",
  homeSpread: -2.5,
  awaySpread: 2.5,
  homeMoneyline: -140,
  awayMoneyline: 120,
  overUnder: 47.5,
};

function makeExternalTeam(externalId: string, teamId: string) {
  return {
    id: `et-${externalId}`,
    dataSourceId: "ds-1",
    externalId,
    teamId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeExternalEvent(externalId: string, eventId: string) {
  return {
    id: `ee-${externalId}`,
    dataSourceId: "ds-1",
    externalId,
    eventId,
    oddsRef: null,
    statusRef: null,
    homeScoreRef: null,
    awayScoreRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// --- Tests ---

describe("runInitialSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(fetchCurrentSeason).mockResolvedValue(SEASON);
    vi.mocked(fetchPhases).mockResolvedValue([PHASE]);
    vi.mocked(fetchTeams).mockResolvedValue(TEAMS);
    vi.mocked(fetchEvents).mockResolvedValue([EVENT]);
    vi.mocked(fetchOdds).mockResolvedValue(ODDS);

    // getAllExternalTeams is called twice: once before team sync (for existing lookup),
    // once after (for event sync team resolution)
    vi.mocked(getAllExternalTeams)
      .mockResolvedValueOnce([]) // before team sync: no existing teams
      .mockResolvedValueOnce([
        // after team sync: both teams exist
        makeExternalTeam("12", "team-kc"),
        makeExternalTeam("33", "team-bal"),
      ]);

    vi.mocked(getAllExternalEvents).mockResolvedValue([]);
  });

  it("seeds reference data first", async () => {
    await runInitialSetup();

    expect(upsertDataSource).toHaveBeenCalledWith({ name: "ESPN" });
    expect(
      vi.mocked(await import("@/data/sports")).upsertSportsbook,
    ).toHaveBeenCalledWith({
      name: "ESPN Bet",
    });
    expect(
      vi.mocked(await import("@/data/sports")).upsertSportsLeague,
    ).toHaveBeenCalledWith({
      name: "National Football League",
      abbreviation: "NFL",
      sport: "football",
    });
  });

  it("syncs current season and creates bridge record", async () => {
    await runInitialSetup();

    expect(upsertSeason).toHaveBeenCalledTimes(1);
    expect(upsertSeason).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2025 }),
    );
    expect(upsertExternalSeason).toHaveBeenCalledTimes(1);
    expect(upsertExternalSeason).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSourceId: "ds-1",
        externalId: "2025",
      }),
    );
  });

  it("syncs phases with calculated lock times", async () => {
    await runInitialSetup();

    expect(calculatePickLockTime).toHaveBeenCalledWith(
      PHASE.startDate,
      "regular",
    );
    expect(upsertPhase).toHaveBeenCalledWith(
      expect.objectContaining({
        seasonType: "regular",
        weekNumber: 1,
        label: "Week 1",
      }),
    );
    expect(upsertExternalPhase).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSourceId: "ds-1",
        externalId: "2025-2-1",
      }),
    );
  });

  it("inserts new teams and creates bridge records", async () => {
    await runInitialSetup();

    expect(insertTeam).toHaveBeenCalledTimes(2);
    expect(insertTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Chiefs",
        abbreviation: "KC",
      }),
    );
    expect(upsertExternalTeam).toHaveBeenCalledTimes(2);
  });

  it("updates existing teams instead of inserting", async () => {
    // KC already exists in first batch fetch
    vi.mocked(getAllExternalTeams)
      .mockReset()
      .mockResolvedValueOnce([makeExternalTeam("12", "team-existing")])
      .mockResolvedValueOnce([
        makeExternalTeam("12", "team-existing"),
        makeExternalTeam("33", "team-bal"),
      ]);

    await runInitialSetup();

    expect(updateTeam).toHaveBeenCalledWith(
      "team-existing",
      expect.objectContaining({ name: "Chiefs" }),
    );
    expect(insertTeam).toHaveBeenCalledTimes(1);
  });

  it("syncs events and resolves team IDs from bridge table", async () => {
    await runInitialSetup();

    expect(fetchEvents).toHaveBeenCalledWith(2025, 2, 1);
    expect(insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        homeTeamId: "team-kc",
        awayTeamId: "team-bal",
        startTime: EVENT.startTime,
      }),
    );
    expect(upsertExternalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "401547417",
        oddsRef: EVENT.refs.oddsRef,
        statusRef: EVENT.refs.statusRef,
      }),
    );
  });

  it("updates existing events instead of inserting", async () => {
    vi.mocked(getAllExternalEvents).mockResolvedValue([
      makeExternalEvent("401547417", "event-existing"),
    ]);

    await runInitialSetup();

    expect(updateEvent).toHaveBeenCalledWith(
      "event-existing",
      expect.objectContaining({
        homeTeamId: "team-kc",
        awayTeamId: "team-bal",
      }),
    );
    expect(insertEvent).not.toHaveBeenCalled();
  });

  it("snaps phase dates to Tuesday 2 AM ET boundaries", async () => {
    await runInitialSetup();

    const { calculatePhaseStartBoundary, calculatePhaseEndBoundary } =
      await import("@/lib/nfl/scheduling");

    expect(calculatePhaseStartBoundary).toHaveBeenCalledWith(EVENT.startTime);
    expect(calculatePhaseEndBoundary).toHaveBeenCalledWith(EVENT.startTime);
    expect(updatePhase).toHaveBeenCalledWith("phase-1", {
      startDate: new Date("2025-09-09T06:00:00Z"),
      endDate: new Date("2025-09-16T06:00:00Z"),
    });
  });

  it("syncs odds and links sportsbook via bridge table", async () => {
    await runInitialSetup();

    expect(fetchOdds).toHaveBeenCalledWith(EVENT.refs.oddsRef);
    expect(upsertExternalSportsbook).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSourceId: "ds-1",
        externalId: "1002",
        sportsbookId: "sb-1",
      }),
    );
    expect(upsertOdds).toHaveBeenCalledWith(
      expect.objectContaining({
        homeSpread: -2.5,
        awaySpread: 2.5,
        overUnder: 47.5,
      }),
    );
  });

  it("skips events where team IDs cannot be resolved", async () => {
    // Both batch fetches return empty — no teams at all
    vi.mocked(getAllExternalTeams).mockReset().mockResolvedValue([]);

    await runInitialSetup();

    expect(insertEvent).not.toHaveBeenCalled();
    expect(upsertExternalEvent).not.toHaveBeenCalled();
  });

  it("skips odds when fetchOdds returns null", async () => {
    vi.mocked(fetchOdds).mockResolvedValue(null);

    await runInitialSetup();

    expect(upsertOdds).not.toHaveBeenCalled();
  });
});
