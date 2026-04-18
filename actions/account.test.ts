import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeagueMembershipSummary } from "@/data/members";
import { UnauthorizedError } from "@/lib/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/data/members", () => ({
  getLeagueMembershipSummaryForUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/account", () => ({
  anonymizeUser: vi.fn(),
  getSoleCommissionerBlockers: vi.fn(),
}));

vi.mock("@/data/utils", () => ({
  withTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn("tx-handle"),
  ),
}));

import { revalidatePath } from "next/cache";
import { getLeagueMembershipSummaryForUser } from "@/data/members";
import { withTransaction } from "@/data/utils";
import { anonymizeUser, getSoleCommissionerBlockers } from "@/lib/account";
import { getSession } from "@/lib/auth";

import { deleteAccountAction } from "./account";

const session = { user: { id: "user-1" } };

function summaryRow(
  overrides: Partial<LeagueMembershipSummary> &
    Pick<LeagueMembershipSummary, "leagueId" | "leagueName">,
): LeagueMembershipSummary {
  return {
    leagueId: overrides.leagueId,
    leagueName: overrides.leagueName,
    role: overrides.role ?? "commissioner",
    memberCount: overrides.memberCount ?? 3,
    commissionerCount: overrides.commissionerCount ?? 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(
    session as Awaited<ReturnType<typeof getSession>>,
  );
  vi.mocked(getLeagueMembershipSummaryForUser).mockResolvedValue([]);
  vi.mocked(getSoleCommissionerBlockers).mockReturnValue([]);
});

describe("deleteAccountAction", () => {
  it("throws UnauthorizedError when there is no session", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new UnauthorizedError());
    await expect(deleteAccountAction()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(anonymizeUser).not.toHaveBeenCalled();
  });

  it("returns a business error listing every league that blocks the delete", async () => {
    const blockers = [
      summaryRow({ leagueId: "l-1", leagueName: "Dynasty" }),
      summaryRow({ leagueId: "l-2", leagueName: "Work League" }),
    ];
    vi.mocked(getLeagueMembershipSummaryForUser).mockResolvedValueOnce(
      blockers,
    );
    vi.mocked(getSoleCommissionerBlockers).mockReturnValueOnce(blockers);

    const result = await deleteAccountAction();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Dynasty");
      expect(result.error).toContain("Work League");
    }
    expect(anonymizeUser).not.toHaveBeenCalled();
  });

  it("runs anonymization inside a transaction with the session user id + summary", async () => {
    const summary = [
      summaryRow({
        leagueId: "l-solo",
        leagueName: "Solo",
        memberCount: 1,
      }),
    ];
    vi.mocked(getLeagueMembershipSummaryForUser).mockResolvedValueOnce(summary);

    const result = await deleteAccountAction();
    expect(result.success).toBe(true);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(anonymizeUser).toHaveBeenCalledWith("user-1", summary, "tx-handle");
  });

  it("revalidates the root layout so cached auth/profile data is flushed", async () => {
    await deleteAccountAction();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
