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

vi.mock("@/lib/invites", () => ({
  cleanupInvitesIfFull: vi.fn(),
  joinLeague: vi.fn(),
}));

vi.mock("@/lib/simulator", () => ({
  getAppNow: vi.fn(() => Promise.resolve(new Date())),
}));

vi.mock("@/data/members", () => ({
  getLeagueMember: vi.fn(),
}));

vi.mock("@/data/phases", () => ({
  getPhasesBySeason: vi.fn(),
}));

vi.mock("@/data/seasons", () => ({
  getSeasonsBySportsLeague: vi.fn(),
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
  removeLinkInvite,
  searchInviteCandidates,
  upsertDirectInvite,
} from "@/data/invites";
import { getLeagueMember } from "@/data/members";
import { getPhasesBySeason } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSession } from "@/lib/auth";
import { joinLeague } from "@/lib/invites";
import { assertLeagueCommissioner } from "@/lib/permissions";

import {
  createDirectInviteAction,
  createLinkInviteAction,
  joinViaLinkInviteAction,
  respondToDirectInviteAction,
  revokeDirectInviteAction,
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
  startSeasonType: "regular" as const,
  startWeekNumber: 1,
  endSeasonType: "regular" as const,
  endWeekNumber: 18,
  size: 10,
  picksPerPhase: 5,
  pickType: "straight_up" as const,
  createdAt: new Date("2025-06-01T00:00:00Z"),
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
  year: 2025,
  startDate: new Date("2025-09-01T00:00:00Z"),
  endDate: new Date("2026-02-28T00:00:00Z"),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Future-dated pick lock keeps hasLeagueStartLockPassed=false by default.
const openPhase = {
  id: "phase-1",
  seasonId: season.id,
  seasonType: "regular" as const,
  weekNumber: 1,
  label: "Week 1",
  startDate: new Date("2099-09-07T00:00:00Z"),
  endDate: new Date("2099-09-14T00:00:00Z"),
  pickLockTime: new Date("2099-09-07T17:00:00Z"),
  lockedAt: null,
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
  vi.mocked(getSeasonsBySportsLeague).mockResolvedValue([season]);
  vi.mocked(getPhasesBySeason).mockResolvedValue([openPhase]);
  vi.mocked(upsertDirectInvite).mockResolvedValue(invite);
  vi.mocked(getDirectInviteById).mockResolvedValue({
    ...invite,
    inviteeUserId: inviterUserId,
  });
  vi.mocked(removeDirectInvite).mockResolvedValue(undefined);
  vi.mocked(removeLinkInvite).mockResolvedValue(undefined);
  vi.mocked(joinLeague).mockResolvedValue({ status: "joined" });
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

  it("blocks once the league's start lock has passed", async () => {
    vi.mocked(getPhasesBySeason).mockResolvedValueOnce([
      {
        ...openPhase,
        pickLockTime: new Date("2020-09-07T17:00:00Z"),
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
    expect(joinLeague).not.toHaveBeenCalled();
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
    expect(joinLeague).not.toHaveBeenCalled();
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
    expect(joinLeague).not.toHaveBeenCalled();
  });

  it("surfaces joinLeague errors to the caller", async () => {
    vi.mocked(joinLeague).mockResolvedValueOnce({
      status: "error",
      error: "The league's start lock has passed — you can't join this season.",
    });
    const result = await respondToDirectInviteAction({
      inviteId,
      response: "accept",
    });
    expect(result.success).toBe(false);
  });

  it("delegates accept to joinLeague with the invite id", async () => {
    const result = await respondToDirectInviteAction({
      inviteId,
      response: "accept",
    });
    expect(result.success).toBe(true);
    expect(joinLeague).toHaveBeenCalledWith(league, inviterUserId, "member", {
      directInviteIdToDelete: inviteId,
    });
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

  it("blocks creation once the league's start lock has passed", async () => {
    vi.mocked(getPhasesBySeason).mockResolvedValueOnce([
      {
        ...openPhase,
        pickLockTime: new Date("2020-09-07T17:00:00Z"),
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
    expect(joinLeague).not.toHaveBeenCalled();
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
    expect(joinLeague).not.toHaveBeenCalled();
  });

  it("threads alreadyMember=true through when joinLeague short-circuits", async () => {
    vi.mocked(joinLeague).mockResolvedValueOnce({ status: "already_member" });
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alreadyMember).toBe(true);
    }
  });

  it("surfaces joinLeague errors to the caller", async () => {
    vi.mocked(joinLeague).mockResolvedValueOnce({
      status: "error",
      error: "This league is already at capacity.",
    });
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(false);
  });

  it("delegates to joinLeague without an invite id", async () => {
    const result = await joinViaLinkInviteAction({ token });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ leagueId, alreadyMember: false });
    }
    expect(joinLeague).toHaveBeenCalledWith(league, inviterUserId, "member");
  });
});

describe("revokeDirectInviteAction", () => {
  it("returns a business error when the invite is gone", async () => {
    vi.mocked(getDirectInviteById).mockResolvedValueOnce(null);
    const result = await revokeDirectInviteAction({ inviteId });
    expect(result.success).toBe(false);
    expect(removeDirectInvite).not.toHaveBeenCalled();
  });

  it("propagates ForbiddenError for non-commissioners", async () => {
    vi.mocked(getDirectInviteById).mockResolvedValueOnce({
      id: inviteId,
      leagueId,
      inviteeUserId,
      inviterUserId,
      role: "member",
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(revokeDirectInviteAction({ inviteId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("deletes the invite on success", async () => {
    vi.mocked(getDirectInviteById).mockResolvedValueOnce({
      id: inviteId,
      leagueId,
      inviteeUserId,
      inviterUserId,
      role: "member",
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await revokeDirectInviteAction({ inviteId });
    expect(result.success).toBe(true);
    expect(removeDirectInvite).toHaveBeenCalledWith(inviteId);
  });
});
