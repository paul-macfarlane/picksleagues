import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "@/lib/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/account", () => ({
  anonymizeUser: vi.fn(),
}));

vi.mock("@/data/utils", () => ({
  withTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn("tx-handle"),
  ),
}));

import { revalidatePath } from "next/cache";
import { withTransaction } from "@/data/utils";
import { anonymizeUser } from "@/lib/account";
import { getSession } from "@/lib/auth";

import { deleteAccountAction } from "./account";

const session = { user: { id: "user-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(
    session as Awaited<ReturnType<typeof getSession>>,
  );
});

describe("deleteAccountAction", () => {
  it("throws UnauthorizedError when there is no session", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new UnauthorizedError());
    await expect(deleteAccountAction()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(anonymizeUser).not.toHaveBeenCalled();
  });

  it("runs anonymization inside a transaction with the session user id", async () => {
    const result = await deleteAccountAction();
    expect(result.success).toBe(true);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(anonymizeUser).toHaveBeenCalledWith("user-1", "tx-handle");
  });

  it("revalidates the root layout so cached auth/profile data is flushed", async () => {
    await deleteAccountAction();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
