import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/data/leagues", () => ({
  getLeagueById: vi.fn(),
  getLeagueMemberCount: vi.fn(),
}));

vi.mock("@/data/invites", () => ({
  getDirectInviteById: vi.fn(),
  getLinkInviteById: vi.fn(),
  getLinkInviteByToken: vi.fn(),
  insertLinkInvite: vi.fn(),
  removeDirectInvite: vi.fn(),
  removeDirectInvitesByLeague: vi.fn(),
  removeLinkInvite: vi.fn(),
  removeLinkInvitesByLeague: vi.fn(),
  searchInviteCandidates: vi.fn(),
  upsertDirectInvite: vi.fn(),
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

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  assertLeagueCommissioner: vi.fn(),
}));

import { getLeagueById, getLeagueMemberCount } from "@/data/leagues";
import {
  getDirectInviteById,
  getLinkInviteById,
  getLinkInviteByToken,
  insertLinkInvite,
  removeDirectInvite,
  removeDirectInvitesByLeague,
  removeLinkInvite,
  removeLinkInvitesByLeague,
  searchInviteCandidates,
  upsertDirectInvite,
} from "@/data/invites";
import { getLeagueMember, insertLeagueMember } from "@/data/members";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { insertLeagueStanding } from "@/data/standings";
import { getSession } from "@/lib/auth";
import { assertLeagueCommissioner } from "@/lib/permissions";

import {
  createDirectInviteAction,
  createLinkInviteAction,
  joinViaLinkInviteAction,
  respondToDirectInviteAction,
  revokeLinkInviteAction,
  searchInviteCandidatesAction,
} from "./invites";

const leagueId = "33333333-3333-4333-8333-333333333333";
const inviteeUserId = "invitee-1";
const inviterUserId = "user-1";
const inviteId = "44444444-4444-4444-8444-444444444444";

const league = {
  id: leagueId,
  sportsLeagueId: "nfl-id",
  name: "Test League",
  imageUrl: null,
  seasonFormat: "regular_season" as const,
  size: 10,
  picksPerPhase: 5,
  pickType: "straight_up" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const session = { user: { id: inviterUserId } };

const invite = {
  id: inviteId,
  leagueId,
  inviteeUserId,
  inviterUserId,
  role: "member" as const,
  expiresAt: new Date(Date.now() + 7 * 86400_000),
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
  vi.mocked(getSession).mockResolvedValue(
    session as Awaited<ReturnType<typeof getSession>>,
  );
  vi.mocked(assertLeagueCommissioner).mockResolvedValue({
    id: "m-1",
    leagueId,
    userId: inviterUserId,
    role: "commissioner",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(getLeagueById).mockResolvedValue(league);
  vi.mocked(getLeagueMember).mockResolvedValue(null);
  vi.mocked(getLeagueMemberCount).mockResolvedValue(1);
  vi.mocked(getActivePhasesForSportsLeague).mockResolvedValue([]);
  vi.mocked(upsertDirectInvite).mockResolvedValue(invite);
  vi.mocked(getDirectInviteById).mockResolvedValue({
    ...invite,
    inviteeUserId: inviterUserId,
  });
  vi.mocked(getSeasonsBySportsLeague).mockResolvedValue([season]);
  vi.mocked(insertLeagueMember).mockResolvedValue({
    id: "m-new",
    leagueId,
    userId: inviterUserId,
    role: "member",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(insertLeagueStanding).mockResolvedValue({
    id: "s-new",
    leagueId,
    userId: inviterUserId,
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
  vi.mocked(removeLinkInvite).mockResolvedValue(undefined);
  vi.mocked(removeLinkInvitesByLeague).mockResolvedValue(undefined);
  vi.mocked(searchInviteCandidates).mockResolvedValue([]);
  vi.mocked(insertLinkInvite).mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    leagueId,
    token: "token-1",
    role: "member",
    inviterUserId,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(getLinkInviteById).mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    leagueId,
    token: "token-1",
    role: "member",
    inviterUserId,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(getLinkInviteByToken).mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    leagueId,
    token: "token-1",
    role: "member",
    inviterUserId,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("createDirectInviteAction", () => {
  const validCreate = {
    leagueId,
    inviteeUserId,
    role: "member",
    expirationDays: 7,
  } as const;

  it("returns a validation error on bad input", async () => {
    const result = await createDirectInviteAction({
      ...validCreate,
      expirationDays: 0,
    });
    expect(result.success).toBe(false);
    expect(upsertDirectInvite).not.toHaveBeenCalled();
  });

  it("propagates ForbiddenError when the user is not a commissioner", async () => {
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(createDirectInviteAction(validCreate)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("blocks when the invitee is already a member", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce({
      id: "m-x",
      leagueId,
      userId: inviteeUserId,
      role: "member",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await createDirectInviteAction(validCreate);
    expect(result.success).toBe(false);
    expect(upsertDirectInvite).not.toHaveBeenCalled();
  });

  it("blocks when the league is in-season", async () => {
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
    const result = await createDirectInviteAction(validCreate);
    expect(result.success).toBe(false);
    expect(upsertDirectInvite).not.toHaveBeenCalled();
  });

  it("blocks when the league is at capacity", async () => {
    vi.mocked(getLeagueMemberCount).mockResolvedValueOnce(10);
    const result = await createDirectInviteAction(validCreate);
    expect(result.success).toBe(false);
    expect(upsertDirectInvite).not.toHaveBeenCalled();
  });

  it("creates the invite on success", async () => {
    const result = await createDirectInviteAction(validCreate);
    expect(result.success).toBe(true);
    expect(upsertDirectInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId,
        inviteeUserId,
        inviterUserId,
        role: "member",
      }),
    );
  });
});

describe("respondToDirectInviteAction", () => {
  it("declines an invite by deleting it", async () => {
    const result = await respondToDirectInviteAction({
      inviteId,
      response: "decline",
    });
    expect(result.success).toBe(true);
    expect(removeDirectInvite).toHaveBeenCalledWith(inviteId);
    expect(insertLeagueMember).not.toHaveBeenCalled();
  });

  it("rejects when the invite belongs to a different user", async () => {
    vi.mocked(getDirectInviteById).mockResolvedValueOnce({
      ...invite,
      inviteeUserId: "someone-else",
    });
    const result = await respondToDirectInviteAction({
      inviteId,
      response: "accept",
    });
    expect(result.success).toBe(false);
    expect(insertLeagueMember).not.toHaveBeenCalled();
  });

  it("rejects when the invite is expired", async () => {
    vi.mocked(getDirectInviteById).mockResolvedValueOnce({
      ...invite,
      inviteeUserId: inviterUserId,
      expiresAt: new Date(Date.now() - 1000),
    });
    const result = await respondToDirectInviteAction({
      inviteId,
      response: "accept",
    });
    expect(result.success).toBe(false);
    expect(insertLeagueMember).not.toHaveBeenCalled();
  });

  it("rejects when the league is in-season", async () => {
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
    const result = await respondToDirectInviteAction({
      inviteId,
      response: "accept",
    });
    expect(result.success).toBe(false);
    expect(insertLeagueMember).not.toHaveBeenCalled();
  });

  it("rejects when the league is at capacity", async () => {
    vi.mocked(getLeagueMemberCount).mockResolvedValueOnce(10);
    const result = await respondToDirectInviteAction({
      inviteId,
      response: "accept",
    });
    expect(result.success).toBe(false);
    expect(insertLeagueMember).not.toHaveBeenCalled();
  });

  it("accepts by inserting member + standing + removing invite", async () => {
    const result = await respondToDirectInviteAction({
      inviteId,
      response: "accept",
    });
    expect(result.success).toBe(true);
    expect(insertLeagueMember).toHaveBeenCalled();
    expect(insertLeagueStanding).toHaveBeenCalled();
    expect(removeDirectInvite).toHaveBeenCalled();
    expect(removeDirectInvitesByLeague).not.toHaveBeenCalled();
  });

  it("wipes remaining direct and link invites when the league hits capacity", async () => {
    vi.mocked(getLeagueMemberCount)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(10);
    const result = await respondToDirectInviteAction({
      inviteId,
      response: "accept",
    });
    expect(result.success).toBe(true);
    expect(removeDirectInvitesByLeague).toHaveBeenCalledWith(leagueId);
    expect(removeLinkInvitesByLeague).toHaveBeenCalledWith(leagueId);
  });
});

describe("searchInviteCandidatesAction", () => {
  it("returns a validation error on missing query", async () => {
    const result = await searchInviteCandidatesAction({
      leagueId,
      query: "",
    });
    expect(result.success).toBe(false);
    expect(searchInviteCandidates).not.toHaveBeenCalled();
  });

  it("propagates ForbiddenError for non-commissioners", async () => {
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(
      searchInviteCandidatesAction({ leagueId, query: "al" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns up to the configured candidate limit", async () => {
    const profiles = Array.from({ length: 3 }).map((_, i) => ({
      id: `p-${i}`,
      userId: `u-${i}`,
      username: `user-${i}`,
      name: `User ${i}`,
      avatarUrl: null,
      role: "user" as const,
      setupComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    vi.mocked(searchInviteCandidates).mockResolvedValueOnce(profiles);
    const result = await searchInviteCandidatesAction({
      leagueId,
      query: "user",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(3);
    }
    expect(searchInviteCandidates).toHaveBeenCalledWith(leagueId, "user", 10);
  });
});

describe("createLinkInviteAction", () => {
  const validCreate = {
    leagueId,
    role: "member",
    expirationDays: 7,
  } as const;

  it("propagates ForbiddenError for non-commissioners", async () => {
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(createLinkInviteAction(validCreate)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("blocks creation while in-season", async () => {
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
    const result = await createLinkInviteAction(validCreate);
    expect(result.success).toBe(false);
    expect(insertLinkInvite).not.toHaveBeenCalled();
  });

  it("blocks creation at capacity", async () => {
    vi.mocked(getLeagueMemberCount).mockResolvedValueOnce(10);
    const result = await createLinkInviteAction(validCreate);
    expect(result.success).toBe(false);
    expect(insertLinkInvite).not.toHaveBeenCalled();
  });

  it("creates a link invite on success", async () => {
    const result = await createLinkInviteAction(validCreate);
    expect(result.success).toBe(true);
    expect(insertLinkInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId,
        inviterUserId,
        role: "member",
        token: expect.any(String),
      }),
    );
  });
});

describe("revokeLinkInviteAction", () => {
  const inviteId = "55555555-5555-4555-8555-555555555555";

  it("returns an error when the invite is gone", async () => {
    vi.mocked(getLinkInviteById).mockResolvedValueOnce(null);
    const result = await revokeLinkInviteAction({ inviteId });
    expect(result.success).toBe(false);
    expect(removeLinkInvite).not.toHaveBeenCalled();
  });

  it("propagates ForbiddenError for non-commissioners", async () => {
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(revokeLinkInviteAction({ inviteId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("deletes the invite on success", async () => {
    const result = await revokeLinkInviteAction({ inviteId });
    expect(result.success).toBe(true);
    expect(removeLinkInvite).toHaveBeenCalledWith(inviteId);
  });
});

describe("joinViaLinkInviteAction", () => {
  const token = "token-1";

  it("returns an error when the token is unknown", async () => {
    vi.mocked(getLinkInviteByToken).mockResolvedValueOnce(null);
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(false);
  });

  it("returns an error when the invite is expired", async () => {
    vi.mocked(getLinkInviteByToken).mockResolvedValueOnce({
      id: "55555555-5555-4555-8555-555555555555",
      leagueId,
      token,
      role: "member",
      inviterUserId,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(false);
  });

  it("short-circuits when the user is already a member", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce({
      id: "m-existing",
      leagueId,
      userId: inviterUserId,
      role: "member",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(true);
  });

  it("blocks when the league is in-season", async () => {
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
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(false);
  });

  it("blocks when the league is at capacity", async () => {
    vi.mocked(getLeagueMemberCount).mockResolvedValueOnce(10);
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(false);
  });

  it("joins by inserting member + standing", async () => {
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(true);
    expect(insertLeagueMember).toHaveBeenCalled();
    expect(insertLeagueStanding).toHaveBeenCalled();
  });

  it("wipes remaining invites when the league hits capacity on join", async () => {
    vi.mocked(getLeagueMemberCount)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(10);
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(true);
    expect(removeDirectInvitesByLeague).toHaveBeenCalledWith(leagueId);
    expect(removeLinkInvitesByLeague).toHaveBeenCalledWith(leagueId);
  });
});
