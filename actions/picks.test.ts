import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/data/events", () => ({
  getEventsByPhaseWithTeams: vi.fn(),
  getOddsForEventsWithSportsbook: vi.fn(),
}));

vi.mock("@/data/leagues", () => ({
  getLeagueById: vi.fn(),
}));

vi.mock("@/data/phases", () => ({
  getPhaseById: vi.fn(),
}));

vi.mock("@/data/picks", () => ({
  deleteUserPicksForEvents: vi.fn(),
  insertPicks: vi.fn(),
}));

vi.mock("@/data/seasons", () => ({
  getSeasonsBySportsLeague: vi.fn(),
}));

vi.mock("@/data/utils", () => ({
  withTransaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn({})),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  assertLeagueMember: vi.fn(),
}));

vi.mock("@/lib/simulator", () => ({
  getAppNow: vi.fn(),
}));

import {
  getEventsByPhaseWithTeams,
  getOddsForEventsWithSportsbook,
} from "@/data/events";
import { getLeagueById } from "@/data/leagues";
import { getPhaseById } from "@/data/phases";
import { deleteUserPicksForEvents, insertPicks } from "@/data/picks";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSession } from "@/lib/auth";
import { assertLeagueMember } from "@/lib/permissions";
import { getAppNow } from "@/lib/simulator";

import { submitPicksAction } from "./picks";

const userId = "user-1";
const session = { user: { id: userId } };

const leagueId = "11111111-1111-4111-8111-111111111111";
const phaseId = "22222222-2222-4222-8222-222222222222";
const seasonId = "33333333-3333-4333-8333-333333333333";

const homeTeamId = "44444444-4444-4444-8444-444444444444";
const awayTeamId = "55555555-5555-4555-8555-555555555555";
const eventAId = "66666666-6666-4666-8666-666666666666";
const eventBId = "77777777-7777-4777-8777-777777777777";
const eventCId = "88888888-8888-4888-8888-888888888888";

const straightUpLeague = {
  id: leagueId,
  sportsLeagueId: "nfl-id",
  name: "Test League",
  imageUrl: null,
  startSeasonType: "regular" as const,
  startWeekNumber: 1,
  endSeasonType: "regular" as const,
  endWeekNumber: 18,
  size: 10,
  picksPerPhase: 2,
  pickType: "straight_up" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const atsLeague = {
  ...straightUpLeague,
  pickType: "against_the_spread" as const,
};

const openPhase = {
  id: phaseId,
  seasonId,
  seasonType: "regular" as const,
  weekNumber: 3,
  label: "Week 3",
  startDate: new Date("2099-09-20T00:00:00Z"),
  endDate: new Date("2099-09-27T00:00:00Z"),
  pickLockTime: new Date("2099-09-21T17:00:00Z"),
  lockedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const currentSeason = {
  id: seasonId,
  sportsLeagueId: "nfl-id",
  year: 2099,
  startDate: new Date("2099-09-01T00:00:00Z"),
  endDate: new Date("2100-02-28T00:00:00Z"),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeEvent(
  id: string,
  startTime: Date,
  overrides: { homeTeamId?: string; awayTeamId?: string } = {},
) {
  const home = {
    id: overrides.homeTeamId ?? homeTeamId,
    sportsLeagueId: "nfl-id",
    name: "Home",
    location: "Home",
    abbreviation: "HOM",
    logoUrl: null,
    logoDarkUrl: null,
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const away = {
    ...home,
    id: overrides.awayTeamId ?? awayTeamId,
    name: "Away",
    location: "Away",
    abbreviation: "AWY",
  };
  return {
    id,
    phaseId,
    homeTeamId: home.id,
    awayTeamId: away.id,
    startTime,
    status: "not_started" as const,
    homeScore: null,
    awayScore: null,
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    homeTeam: home,
    awayTeam: away,
  };
}

const nowBeforeLock = new Date("2099-09-20T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(
    session as Awaited<ReturnType<typeof getSession>>,
  );
  vi.mocked(assertLeagueMember).mockResolvedValue({
    id: "m-1",
    leagueId,
    userId,
    role: "member",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(getLeagueById).mockResolvedValue(straightUpLeague);
  vi.mocked(getPhaseById).mockResolvedValue(openPhase);
  vi.mocked(getSeasonsBySportsLeague).mockResolvedValue([currentSeason]);
  vi.mocked(getAppNow).mockResolvedValue(nowBeforeLock);
  vi.mocked(getOddsForEventsWithSportsbook).mockResolvedValue([]);
  vi.mocked(deleteUserPicksForEvents).mockResolvedValue(undefined);
  vi.mocked(insertPicks).mockResolvedValue([]);
});

describe("submitPicksAction", () => {
  it("rejects invalid input before touching the DB", async () => {
    const result = await submitPicksAction({ junk: true });
    expect(result).toEqual({
      success: false,
      error: expect.any(String),
    });
    expect(insertPicks).not.toHaveBeenCalled();
  });

  it("propagates ForbiddenError when the user is not a member", async () => {
    vi.mocked(assertLeagueMember).mockRejectedValueOnce(
      new ForbiddenError("Not a league member"),
    );
    await expect(
      submitPicksAction({
        leagueId,
        phaseId,
        picks: [{ eventId: eventAId, teamId: homeTeamId }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns 'League not found' when league is missing", async () => {
    vi.mocked(getLeagueById).mockResolvedValueOnce(null);
    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(result).toEqual({ success: false, error: "League not found." });
  });

  it("rejects a phase that isn't in the league's range", async () => {
    vi.mocked(getPhaseById).mockResolvedValueOnce({
      ...openPhase,
      seasonType: "postseason",
      weekNumber: 1,
    });
    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(result.success).toBe(false);
    expect(result).toMatchObject({
      error: expect.stringContaining("isn't part of this league"),
    });
  });

  it("rejects a phase whose seasonId doesn't match the current season", async () => {
    vi.mocked(getPhaseById).mockResolvedValueOnce({
      ...openPhase,
      seasonId: "99999999-9999-4999-8999-999999999999",
    });
    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("isn't in the current season"),
    });
    expect(insertPicks).not.toHaveBeenCalled();
  });

  it("rejects submission after the phase's pick lock", async () => {
    vi.mocked(getAppNow).mockResolvedValueOnce(
      new Date("2099-09-21T17:00:00Z"),
    );
    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(result).toEqual({
      success: false,
      error: "Picks have locked for this phase.",
    });
  });

  it("requires exactly min(picksPerPhase, unstartedGames) picks", async () => {
    // 3 unstarted games, picksPerPhase=2 → required = 2
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-21T16:00:00Z")),
      makeEvent(eventBId, new Date("2099-09-21T16:00:00Z")),
      makeEvent(eventCId, new Date("2099-09-21T16:00:00Z")),
    ]);

    const tooFew = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(tooFew).toMatchObject({
      success: false,
      error: expect.stringContaining("exactly 2"),
    });

    const tooMany = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [
        { eventId: eventAId, teamId: homeTeamId },
        { eventId: eventBId, teamId: homeTeamId },
        { eventId: eventCId, teamId: homeTeamId },
      ],
    });
    expect(tooMany).toMatchObject({
      success: false,
      error: expect.stringContaining("exactly 2"),
    });
  });

  it("clamps required count to unstarted games when fewer than picksPerPhase remain", async () => {
    // 2 unstarted + 1 started (locked) → required = min(2, 2) = 2
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-21T16:00:00Z")), // unstarted
      makeEvent(eventBId, new Date("2099-09-21T16:00:00Z")), // unstarted
      makeEvent(eventCId, new Date("2099-09-20T00:00:00Z")), // started before now
    ]);

    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [
        { eventId: eventAId, teamId: homeTeamId },
        { eventId: eventBId, teamId: homeTeamId },
      ],
    });
    expect(result).toEqual({ success: true, data: undefined });
    expect(insertPicks).toHaveBeenCalledTimes(1);
    expect(insertPicks).toHaveBeenCalledWith(
      [
        expect.objectContaining({ eventId: eventAId, teamId: homeTeamId }),
        expect.objectContaining({ eventId: eventBId, teamId: homeTeamId }),
      ],
      {},
    );
  });

  it("rejects a pick on a game that has already started", async () => {
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-20T00:00:00Z")), // started
      makeEvent(eventBId, new Date("2099-09-21T16:00:00Z")),
    ]);
    // With 1 unstarted event, required count = 1. Picking a started game
    // should fail at the event-status check.
    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("already started"),
    });
  });

  it("rejects duplicate game picks in a single submission", async () => {
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-21T16:00:00Z")),
      makeEvent(eventBId, new Date("2099-09-21T16:00:00Z")),
    ]);
    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [
        { eventId: eventAId, teamId: homeTeamId },
        { eventId: eventAId, teamId: awayTeamId },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("only be picked once"),
    });
  });

  it("rejects a pick whose team isn't in the game", async () => {
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-21T16:00:00Z")),
      makeEvent(eventBId, new Date("2099-09-21T16:00:00Z")),
    ]);
    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [
        { eventId: eventAId, teamId: homeTeamId },
        { eventId: eventBId, teamId: "99999999-9999-4999-8999-999999999999" },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("isn't in that game"),
    });
  });

  it("deletes existing picks on unstarted events and inserts new ones in a transaction", async () => {
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-21T16:00:00Z")),
      makeEvent(eventBId, new Date("2099-09-21T16:00:00Z")),
    ]);

    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [
        { eventId: eventAId, teamId: homeTeamId },
        { eventId: eventBId, teamId: awayTeamId },
      ],
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(deleteUserPicksForEvents).toHaveBeenCalledWith(
      leagueId,
      userId,
      [eventAId, eventBId],
      {},
    );
    expect(insertPicks).toHaveBeenCalledTimes(1);
    expect(insertPicks).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          leagueId,
          userId,
          phaseId,
          eventId: eventAId,
          teamId: homeTeamId,
          spreadAtLock: null,
        }),
        expect.objectContaining({
          leagueId,
          userId,
          phaseId,
          eventId: eventBId,
          teamId: awayTeamId,
          spreadAtLock: null,
        }),
      ],
      {},
    );
  });

  it("freezes the picked team's spread on ATS leagues", async () => {
    vi.mocked(getLeagueById).mockResolvedValueOnce(atsLeague);
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-21T16:00:00Z")),
    ]);
    vi.mocked(getOddsForEventsWithSportsbook).mockResolvedValueOnce([
      {
        id: "odds-1",
        eventId: eventAId,
        sportsbookId: "sb-1",
        sportsbookName: "ESPN Bet",
        homeSpread: -3.5,
        awaySpread: 3.5,
        homeMoneyline: -150,
        awayMoneyline: 130,
        overUnder: 45.5,
        lockedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: awayTeamId }],
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(insertPicks).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          eventId: eventAId,
          teamId: awayTeamId,
          spreadAtLock: 3.5,
        }),
      ],
      {},
    );
  });

  it("rejects ATS submission when spreads aren't synced yet", async () => {
    vi.mocked(getLeagueById).mockResolvedValueOnce(atsLeague);
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-21T16:00:00Z")),
    ]);
    // No odds rows returned
    vi.mocked(getOddsForEventsWithSportsbook).mockResolvedValueOnce([]);

    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Spreads aren't available"),
    });
    expect(insertPicks).not.toHaveBeenCalled();
  });

  it("preserves picks on already-started games when re-submitting (§7.2)", async () => {
    // 2 started + 2 unstarted. required = min(picksPerPhase=2, unstarted=2) = 2.
    // The delete only targets unstarted event ids; started-event picks stay.
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-20T00:00:00Z")), // started
      makeEvent(eventBId, new Date("2099-09-20T00:00:00Z")), // started
      makeEvent(eventCId, new Date("2099-09-21T16:00:00Z")), // unstarted
      makeEvent(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        new Date("2099-09-21T16:00:00Z"),
      ),
    ]);

    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [
        { eventId: eventCId, teamId: homeTeamId },
        {
          eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          teamId: homeTeamId,
        },
      ],
    });

    expect(result).toEqual({ success: true, data: undefined });
    // The delete scope excludes eventAId/eventBId (started), so their picks
    // survive the re-submit — this is the §7.2 guarantee.
    expect(deleteUserPicksForEvents).toHaveBeenCalledWith(
      leagueId,
      userId,
      [eventCId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      {},
    );
  });

  it("re-submitting an ATS pick refreshes spreadAtLock from the current odds (§9.3)", async () => {
    vi.mocked(getLeagueById).mockResolvedValue(atsLeague);
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-21T16:00:00Z")),
    ]);
    // Simulate a line move between submissions: first -3.5, then -7.
    vi.mocked(getOddsForEventsWithSportsbook)
      .mockResolvedValueOnce([
        {
          id: "odds-1",
          eventId: eventAId,
          sportsbookId: "sb-1",
          sportsbookName: "ESPN Bet",
          homeSpread: -3.5,
          awaySpread: 3.5,
          homeMoneyline: -150,
          awayMoneyline: 130,
          overUnder: 45.5,
          lockedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "odds-1",
          eventId: eventAId,
          sportsbookId: "sb-1",
          sportsbookName: "ESPN Bet",
          homeSpread: -7,
          awaySpread: 7,
          homeMoneyline: -250,
          awayMoneyline: 210,
          overUnder: 46,
          lockedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

    const first = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(first).toEqual({ success: true, data: undefined });
    expect(insertPicks).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ spreadAtLock: -3.5 })],
      {},
    );

    const second = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(second).toEqual({ success: true, data: undefined });
    expect(insertPicks).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ spreadAtLock: -7 })],
      {},
    );
  });

  it("returns an error when there are no unstarted games left", async () => {
    vi.mocked(getEventsByPhaseWithTeams).mockResolvedValue([
      makeEvent(eventAId, new Date("2099-09-20T00:00:00Z")),
    ]);

    const result = await submitPicksAction({
      leagueId,
      phaseId,
      picks: [{ eventId: eventAId, teamId: homeTeamId }],
    });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("No games left"),
    });
  });
});
