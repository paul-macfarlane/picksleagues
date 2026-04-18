import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/data/leagues", () => ({
  getLeagueById: vi.fn(),
  getLeagueMemberCount: vi.fn(),
  removeLeague: vi.fn(),
}));

vi.mock("@/data/members", () => ({
  getCommissionerCount: vi.fn(),
  getLeagueMember: vi.fn(),
  removeLeagueMember: vi.fn(),
  updateLeagueMemberRole: vi.fn(),
}));

vi.mock("@/data/phases", () => ({
  getActivePhasesForSportsLeague: vi.fn(),
}));

vi.mock("@/data/standings", () => ({
  removeLeagueStandingsForUser: vi.fn(),
}));

vi.mock("@/data/utils", () => ({
  withTransaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn({})),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  assertLeagueCommissioner: vi.fn(),
  assertLeagueMember: vi.fn(),
}));

import {
  getLeagueById,
  getLeagueMemberCount,
  removeLeague,
} from "@/data/leagues";
import {
  getCommissionerCount,
  getLeagueMember,
  removeLeagueMember,
  updateLeagueMemberRole,
} from "@/data/members";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { removeLeagueStandingsForUser } from "@/data/standings";
import { getSession } from "@/lib/auth";
import {
  assertLeagueCommissioner,
  assertLeagueMember,
} from "@/lib/permissions";

import {
  demoteMemberAction,
  leaveLeagueAction,
  promoteMemberAction,
  removeMemberAction,
} from "./members";

const leagueId = "66666666-6666-4666-8666-666666666666";
const sessionUserId = "commissioner-1";
const targetUserId = "member-1";

const session = { user: { id: sessionUserId } };

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

function member(role: "commissioner" | "member", userId = targetUserId) {
  return {
    id: `m-${userId}`,
    leagueId,
    userId,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(
    session as Awaited<ReturnType<typeof getSession>>,
  );
  vi.mocked(assertLeagueCommissioner).mockResolvedValue(
    member("commissioner", sessionUserId),
  );
  vi.mocked(getLeagueById).mockResolvedValue(league);
  vi.mocked(getLeagueMemberCount).mockResolvedValue(3);
  vi.mocked(removeLeague).mockResolvedValue(undefined);
  vi.mocked(getActivePhasesForSportsLeague).mockResolvedValue([]);
  vi.mocked(getLeagueMember).mockResolvedValue(member("member"));
  vi.mocked(assertLeagueMember).mockResolvedValue(
    member("member", sessionUserId),
  );
  vi.mocked(updateLeagueMemberRole).mockResolvedValue(member("commissioner"));
  vi.mocked(removeLeagueMember).mockResolvedValue(undefined);
  vi.mocked(removeLeagueStandingsForUser).mockResolvedValue(undefined);
  vi.mocked(getCommissionerCount).mockResolvedValue(2);
});

describe("promoteMemberAction", () => {
  it("promotes a member to commissioner", async () => {
    const result = await promoteMemberAction({
      leagueId,
      userId: targetUserId,
    });
    expect(result.success).toBe(true);
    expect(updateLeagueMemberRole).toHaveBeenCalledWith(
      leagueId,
      targetUserId,
      "commissioner",
    );
  });

  it("refuses when the target is already a commissioner", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce(member("commissioner"));
    const result = await promoteMemberAction({
      leagueId,
      userId: targetUserId,
    });
    expect(result.success).toBe(false);
    expect(updateLeagueMemberRole).not.toHaveBeenCalled();
  });

  it("rejects when the target isn't in the league", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce(null);
    const result = await promoteMemberAction({
      leagueId,
      userId: targetUserId,
    });
    expect(result.success).toBe(false);
  });

  it("propagates ForbiddenError for non-commissioners", async () => {
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(
      promoteMemberAction({ leagueId, userId: targetUserId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("demoteMemberAction", () => {
  it("demotes a commissioner to member", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce(member("commissioner"));
    const result = await demoteMemberAction({ leagueId, userId: targetUserId });
    expect(result.success).toBe(true);
    expect(updateLeagueMemberRole).toHaveBeenCalledWith(
      leagueId,
      targetUserId,
      "member",
    );
  });

  it("rejects when the target isn't a commissioner", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce(member("member"));
    const result = await demoteMemberAction({ leagueId, userId: targetUserId });
    expect(result.success).toBe(false);
    expect(updateLeagueMemberRole).not.toHaveBeenCalled();
  });

  it("blocks self-demote when the user is the sole commissioner", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce(
      member("commissioner", sessionUserId),
    );
    vi.mocked(getCommissionerCount).mockResolvedValueOnce(1);
    const result = await demoteMemberAction({
      leagueId,
      userId: sessionUserId,
    });
    expect(result.success).toBe(false);
    expect(updateLeagueMemberRole).not.toHaveBeenCalled();
  });

  it("allows self-demote when other commissioners exist", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce(
      member("commissioner", sessionUserId),
    );
    vi.mocked(getCommissionerCount).mockResolvedValueOnce(2);
    const result = await demoteMemberAction({
      leagueId,
      userId: sessionUserId,
    });
    expect(result.success).toBe(true);
  });

  it("propagates ForbiddenError for non-commissioners", async () => {
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(
      demoteMemberAction({ leagueId, userId: targetUserId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects when the target isn't in the league", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce(null);
    const result = await demoteMemberAction({
      leagueId,
      userId: targetUserId,
    });
    expect(result.success).toBe(false);
    expect(updateLeagueMemberRole).not.toHaveBeenCalled();
  });
});

describe("removeMemberAction", () => {
  it("rejects self-removal", async () => {
    const result = await removeMemberAction({
      leagueId,
      userId: sessionUserId,
    });
    expect(result.success).toBe(false);
    expect(removeLeagueMember).not.toHaveBeenCalled();
  });

  it("propagates ForbiddenError for non-commissioners", async () => {
    vi.mocked(assertLeagueCommissioner).mockRejectedValueOnce(
      new ForbiddenError("Must be a league commissioner"),
    );
    await expect(
      removeMemberAction({ leagueId, userId: targetUserId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks removal while in-season", async () => {
    vi.mocked(getActivePhasesForSportsLeague).mockResolvedValueOnce([
      {
        id: "p-1",
        seasonId: "s-1",
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
    const result = await removeMemberAction({
      leagueId,
      userId: targetUserId,
    });
    expect(result.success).toBe(false);
    expect(removeLeagueMember).not.toHaveBeenCalled();
  });

  it("rejects when the target isn't in the league", async () => {
    vi.mocked(getLeagueMember).mockResolvedValueOnce(null);
    const result = await removeMemberAction({
      leagueId,
      userId: targetUserId,
    });
    expect(result.success).toBe(false);
    expect(removeLeagueMember).not.toHaveBeenCalled();
  });

  it("removes the member on success", async () => {
    const result = await removeMemberAction({
      leagueId,
      userId: targetUserId,
    });
    expect(result.success).toBe(true);
    expect(removeLeagueMember).toHaveBeenCalledWith(leagueId, targetUserId);
  });
});

describe("leaveLeagueAction", () => {
  it("returns a validation error on bad input", async () => {
    const result = await leaveLeagueAction({ leagueId: "nope" });
    expect(result.success).toBe(false);
    expect(removeLeagueMember).not.toHaveBeenCalled();
    expect(removeLeague).not.toHaveBeenCalled();
  });

  it("blocks leaving while in-season", async () => {
    vi.mocked(getActivePhasesForSportsLeague).mockResolvedValueOnce([
      {
        id: "p-1",
        seasonId: "s-1",
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
    const result = await leaveLeagueAction({ leagueId });
    expect(result.success).toBe(false);
    expect(removeLeagueMember).not.toHaveBeenCalled();
  });

  it("deletes the league when the user is the sole member", async () => {
    vi.mocked(getLeagueMemberCount).mockResolvedValueOnce(1);
    vi.mocked(assertLeagueMember).mockResolvedValueOnce(
      member("commissioner", sessionUserId),
    );
    const result = await leaveLeagueAction({ leagueId });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leagueDeleted).toBe(true);
    }
    expect(removeLeague).toHaveBeenCalledWith(leagueId);
    expect(removeLeagueMember).not.toHaveBeenCalled();
  });

  it("blocks a sole commissioner from leaving when others remain", async () => {
    vi.mocked(assertLeagueMember).mockResolvedValueOnce(
      member("commissioner", sessionUserId),
    );
    vi.mocked(getCommissionerCount).mockResolvedValueOnce(1);
    const result = await leaveLeagueAction({ leagueId });
    expect(result.success).toBe(false);
    expect(removeLeagueMember).not.toHaveBeenCalled();
    expect(removeLeague).not.toHaveBeenCalled();
  });

  it("lets a commissioner leave when other commissioners exist", async () => {
    vi.mocked(assertLeagueMember).mockResolvedValueOnce(
      member("commissioner", sessionUserId),
    );
    vi.mocked(getCommissionerCount).mockResolvedValueOnce(2);
    const result = await leaveLeagueAction({ leagueId });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leagueDeleted).toBe(false);
    }
    expect(removeLeagueMember).toHaveBeenCalledWith(
      leagueId,
      sessionUserId,
      expect.anything(),
    );
    expect(removeLeagueStandingsForUser).toHaveBeenCalledWith(
      leagueId,
      sessionUserId,
      expect.anything(),
    );
  });

  it("lets a regular member leave and clears their standings", async () => {
    const result = await leaveLeagueAction({ leagueId });
    expect(result.success).toBe(true);
    expect(removeLeagueMember).toHaveBeenCalledWith(
      leagueId,
      sessionUserId,
      expect.anything(),
    );
    expect(removeLeagueStandingsForUser).toHaveBeenCalledWith(
      leagueId,
      sessionUserId,
      expect.anything(),
    );
  });
});
