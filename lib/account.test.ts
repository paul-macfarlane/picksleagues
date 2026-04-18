import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeagueMembershipSummary } from "@/data/members";

vi.mock("@/data/auth", () => ({
  deleteSessionsByUserId: vi.fn(),
  deleteAccountsByUserId: vi.fn(),
}));

vi.mock("@/data/leagues", () => ({
  removeLeague: vi.fn(),
}));

vi.mock("@/data/members", () => ({
  removeLeagueMember: vi.fn(),
}));

vi.mock("@/data/profiles", () => ({
  updateProfileByUserId: vi.fn(),
}));

vi.mock("@/data/users", () => ({
  updateUserById: vi.fn(),
}));

import { deleteAccountsByUserId, deleteSessionsByUserId } from "@/data/auth";
import { removeLeague } from "@/data/leagues";
import { removeLeagueMember } from "@/data/members";
import { updateProfileByUserId } from "@/data/profiles";
import { updateUserById } from "@/data/users";

import { anonymizeUser, getSoleCommissionerBlockers } from "./account";

function summaryRow(
  overrides: Partial<LeagueMembershipSummary> &
    Pick<LeagueMembershipSummary, "leagueId" | "leagueName">,
): LeagueMembershipSummary {
  return {
    leagueId: overrides.leagueId,
    leagueName: overrides.leagueName,
    role: overrides.role ?? "member",
    memberCount: overrides.memberCount ?? 1,
    commissionerCount: overrides.commissionerCount ?? 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSoleCommissionerBlockers", () => {
  it("flags leagues where the user is the only commissioner and others are present", () => {
    const multi = summaryRow({
      leagueId: "l-1",
      leagueName: "Multi",
      role: "commissioner",
      memberCount: 3,
      commissionerCount: 1,
    });
    expect(getSoleCommissionerBlockers([multi])).toEqual([multi]);
  });

  it("ignores sole-commissioner leagues where the user is the only member", () => {
    const solo = summaryRow({
      leagueId: "l-2",
      leagueName: "Solo",
      role: "commissioner",
      memberCount: 1,
      commissionerCount: 1,
    });
    expect(getSoleCommissionerBlockers([solo])).toEqual([]);
  });

  it("ignores leagues with another commissioner as backup", () => {
    const shared = summaryRow({
      leagueId: "l-3",
      leagueName: "Shared",
      role: "commissioner",
      memberCount: 4,
      commissionerCount: 2,
    });
    expect(getSoleCommissionerBlockers([shared])).toEqual([]);
  });

  it("ignores leagues where the user is a plain member", () => {
    const plain = summaryRow({
      leagueId: "l-4",
      leagueName: "Plain",
      role: "member",
      memberCount: 5,
      commissionerCount: 1,
    });
    expect(getSoleCommissionerBlockers([plain])).toEqual([]);
  });
});

describe("anonymizeUser", () => {
  it("scrubs the user + profile with userId-suffixed values when there are no leagues", async () => {
    await anonymizeUser("user-1", []);

    expect(deleteSessionsByUserId).toHaveBeenCalledWith("user-1", undefined);
    expect(deleteAccountsByUserId).toHaveBeenCalledWith("user-1", undefined);
    expect(updateUserById).toHaveBeenCalledWith(
      "user-1",
      {
        name: "Anonymous User",
        email: "anonymous+user-1@deleted.picksleagues.local",
        image: null,
      },
      undefined,
    );
    expect(updateProfileByUserId).toHaveBeenCalledWith(
      "user-1",
      {
        username: "anonymous-user-1",
        name: "Anonymous User",
        avatarUrl: null,
      },
      undefined,
    );
    expect(removeLeague).not.toHaveBeenCalled();
    expect(removeLeagueMember).not.toHaveBeenCalled();
  });

  it("truncates the anonymous username to 50 characters for long user ids", async () => {
    const longId = "a".repeat(80);
    await anonymizeUser(longId, []);

    expect(updateProfileByUserId).toHaveBeenCalledWith(
      longId,
      expect.objectContaining({
        username: expect.stringMatching(/^.{50}$/),
      }),
      undefined,
    );
  });

  it("deletes sole-member leagues and removes membership from multi-member leagues", async () => {
    const tx = { tag: "tx" } as never;
    const summary: LeagueMembershipSummary[] = [
      summaryRow({
        leagueId: "solo",
        leagueName: "Solo",
        role: "commissioner",
        memberCount: 1,
        commissionerCount: 1,
      }),
      summaryRow({
        leagueId: "shared",
        leagueName: "Shared",
        role: "member",
        memberCount: 4,
        commissionerCount: 1,
      }),
    ];

    await anonymizeUser("user-2", summary, tx);

    expect(removeLeague).toHaveBeenCalledWith("solo", tx);
    expect(removeLeague).toHaveBeenCalledTimes(1);
    expect(removeLeagueMember).toHaveBeenCalledWith("shared", "user-2", tx);
    expect(removeLeagueMember).toHaveBeenCalledTimes(1);
  });

  it("forwards the transaction handle to every data call", async () => {
    const tx = { tag: "tx" } as never;
    await anonymizeUser("user-3", [], tx);

    expect(deleteSessionsByUserId).toHaveBeenCalledWith("user-3", tx);
    expect(deleteAccountsByUserId).toHaveBeenCalledWith("user-3", tx);
    expect(updateUserById).toHaveBeenCalledWith(
      "user-3",
      expect.any(Object),
      tx,
    );
    expect(updateProfileByUserId).toHaveBeenCalledWith(
      "user-3",
      expect.any(Object),
      tx,
    );
  });
});
