import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FetchedEvent } from "@/lib/espn/nfl/events";
import type { FetchedPhase } from "@/lib/espn/nfl/phases";
import type { FetchedSeason } from "@/lib/espn/nfl/seasons";
import type { FetchedTeam } from "@/lib/espn/nfl/teams";
import type { DataSource, SportsLeague } from "@/lib/db/schema/sports";

import { runStructuralSync } from "./structural";

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
}));

vi.mock("@/data/external", () => ({
  upsertExternalSeason: vi.fn().mockResolvedValue({}),
  upsertExternalPhase: vi.fn().mockResolvedValue({}),
  upsertExternalTeam: vi.fn().mockResolvedValue({}),
  upsertExternalEvent: vi.fn().mockResolvedValue({}),
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

const { upsertSeason } = await import("@/data/seasons");
const { insertTeam, updateTeam } = await import("@/data/teams");
const { insertEvent, updateEvent } = await import("@/data/events");
const { getAllExternalTeams, getAllExternalEvents } =
  await import("@/data/external");
const { fetchCurrentSeason } = await import("@/lib/espn/nfl/seasons");
const { fetchPhases } = await import("@/lib/espn/nfl/phases");
const { fetchTeams } = await import("@/lib/espn/nfl/teams");
const { fetchEvents } = await import("@/lib/espn/nfl/events");

const DATA_SOURCE: DataSource = {
  id: "ds-1",
  name: "ESPN",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SPORTS_LEAGUE: SportsLeague = {
  id: "sl-1",
  name: "National Football League",
  abbreviation: "NFL",
  sport: "football",
  createdAt: new Date(),
  updatedAt: new Date(),
};

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

describe("runStructuralSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(fetchCurrentSeason).mockResolvedValue(SEASON);
    vi.mocked(fetchPhases).mockResolvedValue([PHASE]);
    vi.mocked(fetchTeams).mockResolvedValue(TEAMS);
    vi.mocked(fetchEvents).mockResolvedValue([EVENT]);

    vi.mocked(getAllExternalTeams)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeExternalTeam("12", "team-kc"),
        makeExternalTeam("33", "team-bal"),
      ]);

    vi.mocked(getAllExternalEvents).mockResolvedValue([]);
  });

  it("returns sync counts for the full happy path", async () => {
    const result = await runStructuralSync({
      dataSource: DATA_SOURCE,
      sportsLeague: SPORTS_LEAGUE,
    });

    expect(result.seasonYear).toBe(2025);
    expect(result.seasonId).toBe("season-1");
    expect(result.phasesUpserted).toBe(1);
    expect(result.teamsInserted).toBe(2);
    expect(result.teamsUpdated).toBe(0);
    expect(result.eventsInserted).toBe(1);
    expect(result.eventsUpdated).toBe(0);
    expect(result.eventsSkipped).toBe(0);
    expect(result.oddsToSync).toEqual([
      { eventId: "event-1", oddsRef: EVENT.refs.oddsRef },
    ]);
  });

  it("passes dataSource.id into bridge upserts and sportsLeague.id into insertTeam", async () => {
    await runStructuralSync({
      dataSource: DATA_SOURCE,
      sportsLeague: SPORTS_LEAGUE,
    });

    expect(upsertSeason).toHaveBeenCalledWith(
      expect.objectContaining({ sportsLeagueId: "sl-1", year: 2025 }),
    );
    expect(insertTeam).toHaveBeenCalledWith(
      expect.objectContaining({ sportsLeagueId: "sl-1", name: "Chiefs" }),
    );
  });

  it("updates existing teams instead of inserting", async () => {
    vi.mocked(getAllExternalTeams)
      .mockReset()
      .mockResolvedValueOnce([makeExternalTeam("12", "team-existing")])
      .mockResolvedValueOnce([
        makeExternalTeam("12", "team-existing"),
        makeExternalTeam("33", "team-bal"),
      ]);

    const result = await runStructuralSync({
      dataSource: DATA_SOURCE,
      sportsLeague: SPORTS_LEAGUE,
    });

    expect(updateTeam).toHaveBeenCalledWith(
      "team-existing",
      expect.objectContaining({ name: "Chiefs" }),
    );
    expect(result.teamsInserted).toBe(1);
    expect(result.teamsUpdated).toBe(1);
  });

  it("updates existing events instead of inserting", async () => {
    vi.mocked(getAllExternalEvents).mockResolvedValue([
      {
        id: "ee-1",
        dataSourceId: "ds-1",
        externalId: "401547417",
        eventId: "event-existing",
        oddsRef: null,
        statusRef: null,
        homeScoreRef: null,
        awayScoreRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await runStructuralSync({
      dataSource: DATA_SOURCE,
      sportsLeague: SPORTS_LEAGUE,
    });

    expect(updateEvent).toHaveBeenCalledWith(
      "event-existing",
      expect.objectContaining({
        homeTeamId: "team-kc",
        awayTeamId: "team-bal",
      }),
    );
    expect(insertEvent).not.toHaveBeenCalled();
    expect(result.eventsInserted).toBe(0);
    expect(result.eventsUpdated).toBe(1);
  });

  it("skips events with unresolved team IDs and counts them", async () => {
    vi.mocked(getAllExternalTeams).mockReset().mockResolvedValue([]);

    const result = await runStructuralSync({
      dataSource: DATA_SOURCE,
      sportsLeague: SPORTS_LEAGUE,
    });

    expect(result.eventsSkipped).toBe(1);
    expect(result.eventsInserted).toBe(0);
    expect(insertEvent).not.toHaveBeenCalled();
  });

  it("omits events without oddsRef from oddsToSync", async () => {
    vi.mocked(fetchEvents).mockResolvedValue([
      {
        ...EVENT,
        refs: { ...EVENT.refs, oddsRef: "" },
      },
    ]);

    const result = await runStructuralSync({
      dataSource: DATA_SOURCE,
      sportsLeague: SPORTS_LEAGUE,
    });

    expect(result.oddsToSync).toEqual([]);
  });
});
