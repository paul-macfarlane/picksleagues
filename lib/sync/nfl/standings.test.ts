import { beforeEach, describe, expect, it, vi } from "vitest";

import type { League } from "@/lib/db/schema/leagues";
import type { LeagueMemberWithProfile } from "@/data/members";
import type { PickWithEvent } from "@/data/picks";

vi.mock("@/data/leagues", () => ({
  getLeagueById: vi.fn(),
}));

vi.mock("@/data/members", () => ({
  getLeagueMembersWithProfiles: vi.fn(),
}));

vi.mock("@/data/picks", () => ({
  getLeagueSeasonPairsForEvent: vi.fn(),
  getLeagueSeasonPairsWithUnscoredFinalPicks: vi.fn(),
  getPicksForLeagueSeasonWithEvent: vi.fn(),
  updatePickResults: vi.fn(),
}));

vi.mock("@/data/standings", () => ({
  upsertLeagueStanding: vi.fn(),
}));

vi.mock("@/data/utils", () => ({
  withTransaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn({})),
}));

import { getLeagueById } from "@/data/leagues";
import { getLeagueMembersWithProfiles } from "@/data/members";
import {
  getLeagueSeasonPairsForEvent,
  getLeagueSeasonPairsWithUnscoredFinalPicks,
  getPicksForLeagueSeasonWithEvent,
  updatePickResults,
} from "@/data/picks";
import { upsertLeagueStanding } from "@/data/standings";

import { runStandingsRecalc, runStandingsRecalcForEvent } from "./standings";

const LEAGUE_ID = "league-1";
const SEASON_ID = "season-1";
const EVENT_ID = "event-1";
const HOME = "team-home";
const AWAY = "team-away";
const USER_A = "user-a";
const USER_B = "user-b";
const USER_FORMER = "user-former";

const straightUpLeague: League = {
  id: LEAGUE_ID,
  sportsLeagueId: "nfl",
  name: "Test",
  imageUrl: null,
  startSeasonType: "regular",
  startWeekNumber: 1,
  endSeasonType: "regular",
  endWeekNumber: 18,
  size: 10,
  picksPerPhase: 2,
  pickType: "straight_up",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function member(userId: string): LeagueMemberWithProfile {
  return {
    id: `m-${userId}`,
    leagueId: LEAGUE_ID,
    userId,
    role: "member",
    createdAt: new Date(),
    updatedAt: new Date(),
    profile: {
      id: `p-${userId}`,
      userId,
      username: userId,
      name: userId,
      avatarUrl: null,
      role: "user",
      setupComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

function makePick(
  id: string,
  userId: string,
  teamId: string,
  existingResult: "win" | "loss" | "push" | null,
): PickWithEvent {
  return {
    pick: {
      id,
      leagueId: LEAGUE_ID,
      userId,
      phaseId: "phase-1",
      eventId: EVENT_ID,
      teamId,
      spreadAtLock: null,
      pickResult: existingResult,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    event: {
      id: EVENT_ID,
      phaseId: "phase-1",
      homeTeamId: HOME,
      awayTeamId: AWAY,
      startTime: new Date("2099-09-14T17:00:00Z"),
      status: "final",
      homeScore: 24,
      awayScore: 17,
      period: null,
      clock: null,
      lockedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLeagueById).mockResolvedValue(straightUpLeague);
  vi.mocked(getLeagueMembersWithProfiles).mockResolvedValue([
    member(USER_A),
    member(USER_B),
  ]);
  vi.mocked(getLeagueSeasonPairsWithUnscoredFinalPicks).mockResolvedValue([
    { leagueId: LEAGUE_ID, seasonId: SEASON_ID },
  ]);
  vi.mocked(getLeagueSeasonPairsForEvent).mockResolvedValue([
    { leagueId: LEAGUE_ID, seasonId: SEASON_ID },
  ]);
});

describe("runStandingsRecalc", () => {
  it("scores unscored picks and upserts standings", async () => {
    vi.mocked(getPicksForLeagueSeasonWithEvent).mockResolvedValue([
      makePick("p1", USER_A, HOME, null), // HOME wins → A: win
      makePick("p2", USER_B, AWAY, null), // AWAY loses → B: loss
    ]);

    const result = await runStandingsRecalc();

    expect(result.leaguesAffected).toBe(1);
    expect(result.picksRescored).toBe(2);
    expect(updatePickResults).toHaveBeenCalledWith(
      [
        { id: "p1", pickResult: "win" },
        { id: "p2", pickResult: "loss" },
      ],
      {},
    );
    expect(upsertLeagueStanding).toHaveBeenCalledTimes(2);
    expect(upsertLeagueStanding).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_A,
        wins: 1,
        losses: 0,
        pushes: 0,
        points: 1,
        rank: 1,
      }),
      {},
    );
    expect(upsertLeagueStanding).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_B,
        wins: 0,
        losses: 1,
        pushes: 0,
        points: 0,
        rank: 2,
      }),
      {},
    );
  });

  it("does not re-update pickResults when the cached value already matches", async () => {
    vi.mocked(getPicksForLeagueSeasonWithEvent).mockResolvedValue([
      makePick("p1", USER_A, HOME, "win"),
      makePick("p2", USER_B, AWAY, "loss"),
    ]);

    const result = await runStandingsRecalc();

    expect(result.picksRescored).toBe(0);
    expect(updatePickResults).toHaveBeenCalledWith([], {});
    expect(upsertLeagueStanding).toHaveBeenCalledTimes(2);
  });

  it("re-scores cleared picks from null back to the computed result", async () => {
    // A pick stored as null (e.g. freshly created, never scored) gets
    // re-scored against the current event state on the next recalc.
    vi.mocked(getPicksForLeagueSeasonWithEvent).mockResolvedValue([
      makePick("p1", USER_A, HOME, null),
    ]);

    const result = await runStandingsRecalc();

    expect(updatePickResults).toHaveBeenCalledWith(
      [{ id: "p1", pickResult: "win" }],
      {},
    );
    expect(result.picksRescored).toBe(1);
  });

  it("lazy-inits a zero standing for members without scored picks", async () => {
    // Only A has a pick; B should still get a rank-1 zero standing.
    vi.mocked(getPicksForLeagueSeasonWithEvent).mockResolvedValue([
      makePick("p1", USER_A, HOME, null),
    ]);

    await runStandingsRecalc();

    expect(upsertLeagueStanding).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_B,
        wins: 0,
        losses: 0,
        pushes: 0,
        points: 0,
        rank: 2,
      }),
      {},
    );
  });

  it("preserves picks from a former member in the totals (§4.3)", async () => {
    // USER_FORMER isn't in the members list but has picks. Their totals
    // should still be computed and their standing row upserted, matching
    // §4.3's "removed member's historical picks and standings remain".
    vi.mocked(getLeagueMembersWithProfiles).mockResolvedValue([member(USER_A)]);
    vi.mocked(getPicksForLeagueSeasonWithEvent).mockResolvedValue([
      makePick("p1", USER_A, HOME, null),
      makePick("p2", USER_FORMER, HOME, null),
    ]);

    await runStandingsRecalc();

    expect(upsertLeagueStanding).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_FORMER,
        wins: 1,
        points: 1,
      }),
      {},
    );
  });

  it("no pairs → no work", async () => {
    vi.mocked(getLeagueSeasonPairsWithUnscoredFinalPicks).mockResolvedValue([]);
    const result = await runStandingsRecalc();
    expect(result).toEqual({ leaguesAffected: 0, picksRescored: 0 });
    expect(upsertLeagueStanding).not.toHaveBeenCalled();
  });
});

describe("runStandingsRecalcForEvent", () => {
  it("only recalculates leagues that have picks on the event", async () => {
    vi.mocked(getLeagueSeasonPairsForEvent).mockResolvedValue([
      { leagueId: LEAGUE_ID, seasonId: SEASON_ID },
    ]);
    vi.mocked(getPicksForLeagueSeasonWithEvent).mockResolvedValue([
      makePick("p1", USER_A, HOME, null),
    ]);

    const result = await runStandingsRecalcForEvent(EVENT_ID);

    expect(getLeagueSeasonPairsForEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(result.leaguesAffected).toBe(1);
    expect(upsertLeagueStanding).toHaveBeenCalled();
  });

  it("re-scores picks after an admin clears their pickResult (admin override path)", async () => {
    // Mirrors the admin-override flow: pickResult was cleared (null) and
    // the scoped recalc re-derives it from the event's current score.
    vi.mocked(getLeagueSeasonPairsForEvent).mockResolvedValue([
      { leagueId: LEAGUE_ID, seasonId: SEASON_ID },
    ]);
    vi.mocked(getPicksForLeagueSeasonWithEvent).mockResolvedValue([
      makePick("p1", USER_A, HOME, null),
    ]);

    const result = await runStandingsRecalcForEvent(EVENT_ID);

    expect(updatePickResults).toHaveBeenCalledWith(
      [{ id: "p1", pickResult: "win" }],
      {},
    );
    expect(result.picksRescored).toBe(1);
  });

  it("no-ops when no picks exist on the event", async () => {
    vi.mocked(getLeagueSeasonPairsForEvent).mockResolvedValue([]);
    const result = await runStandingsRecalcForEvent(EVENT_ID);
    expect(result).toEqual({ leaguesAffected: 0, picksRescored: 0 });
    expect(getPicksForLeagueSeasonWithEvent).not.toHaveBeenCalled();
  });
});
