import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/invites", () => ({
  removeDirectInvite: vi.fn(),
  removeDirectInvitesByLeague: vi.fn(),
  removeLinkInvitesByLeague: vi.fn(),
}));

vi.mock("@/data/leagues", () => ({
  getLeagueById: vi.fn(),
  getLeagueMemberCount: vi.fn(),
}));

vi.mock("@/data/members", () => ({
  getLeagueMember: vi.fn(),
  insertLeagueMember: vi.fn(),
}));

vi.mock("@/data/phases", () => ({
  getActivePhasesForSportsLeague: vi.fn(),
}));

vi.mock("@/data/seasons", () => ({
  getSeasonsBySportsLeague: vi.fn(),
}));

vi.mock("@/data/standings", () => ({
  insertLeagueStanding: vi.fn(),
}));

vi.mock("@/data/utils", () => ({
  withTransaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn({})),
}));

vi.mock("@/lib/simulator", () => ({
  getAppNow: vi.fn(() => Promise.resolve(new Date())),
}));

import {
  removeDirectInvite,
  removeDirectInvitesByLeague,
  removeLinkInvitesByLeague,
} from "@/data/invites";
import { getLeagueById, getLeagueMemberCount } from "@/data/leagues";
import { getLeagueMember, insertLeagueMember } from "@/data/members";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { insertLeagueStanding } from "@/data/standings";
import type { League } from "@/lib/db/schema/leagues";

import { cleanupInvitesIfFull, joinLeague } from "./invites";

const leagueId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const league: League = {
  id: leagueId,
  sportsLeagueId: "nfl-id",
  name: "Test League",
  imageUrl: null,
  seasonFormat: "regular_season",
  size: 10,
  picksPerPhase: 5,
  pickType: "straight_up",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const season = {
  id: "season-1",
  sportsLeagueId: "nfl-id",
  year: 2026,
  startDate: new Date("2026-09-01"),
  endDate: new Date("2027-02-28"),
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLeagueMember).mockResolvedValue(null);
  vi.mocked(getLeagueMemberCount).mockResolvedValue(1);
  vi.mocked(getActivePhasesForSportsLeague).mockResolvedValue([]);
  vi.mocked(getSeasonsBySportsLeague).mockResolvedValue([season]);
  vi.mocked(getLeagueById).mockResolvedValue(league);
  vi.mocked(insertLeagueMember).mockResolvedValue({
    id: "m-new",
    leagueId,
    userId: "user-1",
    role: "member",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(insertLeagueStanding).mockResolvedValue({
    id: "s-new",
    leagueId,
    userId: "user-1",
    seasonId: season.id,
    wins: 0,
    losses: 0,
    pushes: 0,
    points: 0,
    rank: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(removeDirectInvite).mockResolvedValue(undefined);
  vi.mocked(removeDirectInvitesByLeague).mockResolvedValue(undefined);
  vi.mocked(removeLinkInvitesByLeague).mockResolvedValue(undefined);
});

describe("joinLeague", () => {
  it("short-circuits when the user is already a member", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce({
      id: "m-existing",
      leagueId,
      userId: "user-1",
      role: "member",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await joinLeague(league, "user-1", "member");
    expect(result).toEqual({ status: "already_member" });
    expect(insertLeagueMember).not.toHaveBeenCalled();
    expect(insertLeagueStanding).not.toHaveBeenCalled();
  });

  it("errors when the league is in-season", async () => {
    vi.mocked(getActivePhasesForSportsLeague).mockResolvedValueOnce([
      {
        id: "p-1",
        seasonId: "season-1",
        seasonType: "regular",
        weekNumber: 2,
        label: "Week 2",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400_000),
        pickLockTime: new Date(),
        lockedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const result = await joinLeague(league, "user-1", "member");
    expect(result.status).toBe("error");
    expect(insertLeagueMember).not.toHaveBeenCalled();
  });

  it("errors when the league is at capacity", async () => {
    vi.mocked(getLeagueMemberCount).mockResolvedValueOnce(10);
    const result = await joinLeague(league, "user-1", "member");
    expect(result.status).toBe("error");
    expect(insertLeagueMember).not.toHaveBeenCalled();
  });

  it("errors when no NFL season is synced", async () => {
    vi.mocked(getSeasonsBySportsLeague).mockResolvedValueOnce([]);
    const result = await joinLeague(league, "user-1", "member");
    expect(result.status).toBe("error");
    expect(insertLeagueMember).not.toHaveBeenCalled();
  });

  it("inserts member + standing on success", async () => {
    const result = await joinLeague(league, "user-1", "member");
    expect(result).toEqual({ status: "joined" });
    expect(insertLeagueMember).toHaveBeenCalledWith(
      { leagueId, userId: "user-1", role: "member" },
      expect.anything(),
    );
    expect(insertLeagueStanding).toHaveBeenCalledWith(
      { leagueId, userId: "user-1", seasonId: season.id },
      expect.anything(),
    );
    expect(removeDirectInvite).not.toHaveBeenCalled();
  });

  it("also removes the consumed direct invite when one is supplied", async () => {
    const inviteId = "invite-1";
    const result = await joinLeague(league, "user-1", "member", {
      directInviteIdToDelete: inviteId,
    });
    expect(result).toEqual({ status: "joined" });
    expect(removeDirectInvite).toHaveBeenCalledWith(
      inviteId,
      expect.anything(),
    );
  });

  it("wipes remaining invites when the join fills the league", async () => {
    vi.mocked(getLeagueMemberCount)
      .mockResolvedValueOnce(9) // pre-join count
      .mockResolvedValueOnce(10); // cleanupInvitesIfFull re-read
    const result = await joinLeague(league, "user-1", "member");
    expect(result).toEqual({ status: "joined" });
    expect(removeDirectInvitesByLeague).toHaveBeenCalledWith(
      leagueId,
      undefined,
    );
    expect(removeLinkInvitesByLeague).toHaveBeenCalledWith(leagueId, undefined);
  });
});

describe("cleanupInvitesIfFull", () => {
  it("no-ops when the league is missing", async () => {
    vi.mocked(getLeagueById).mockResolvedValueOnce(null);
    await cleanupInvitesIfFull(leagueId);
    expect(removeDirectInvitesByLeague).not.toHaveBeenCalled();
    expect(removeLinkInvitesByLeague).not.toHaveBeenCalled();
  });

  it("no-ops when the league is under capacity", async () => {
    vi.mocked(getLeagueMemberCount).mockResolvedValueOnce(3);
    await cleanupInvitesIfFull(leagueId);
    expect(removeDirectInvitesByLeague).not.toHaveBeenCalled();
    expect(removeLinkInvitesByLeague).not.toHaveBeenCalled();
  });

  it("wipes both invite tables when the league is at or over capacity", async () => {
    vi.mocked(getLeagueMemberCount).mockResolvedValueOnce(10);
    await cleanupInvitesIfFull(leagueId);
    expect(removeDirectInvitesByLeague).toHaveBeenCalledWith(
      leagueId,
      undefined,
    );
    expect(removeLinkInvitesByLeague).toHaveBeenCalledWith(leagueId, undefined);
  });
});
