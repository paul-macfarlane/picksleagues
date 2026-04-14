import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/auth", () => ({
  deleteSessionsByUserId: vi.fn(),
  deleteAccountsByUserId: vi.fn(),
}));

vi.mock("@/data/profiles", () => ({
  updateProfileByUserId: vi.fn(),
}));

vi.mock("@/data/users", () => ({
  updateUserById: vi.fn(),
}));

import { deleteAccountsByUserId, deleteSessionsByUserId } from "@/data/auth";
import { updateProfileByUserId } from "@/data/profiles";
import { updateUserById } from "@/data/users";

import { anonymizeUser } from "./account";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("anonymizeUser", () => {
  it("deletes sessions + accounts, then scrubs user + profile with userId-suffixed values", async () => {
    await anonymizeUser("user-1");

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
  });

  // Covers the 50-char unique profile.username constraint (see lib/validators/profiles.ts).
  it("truncates the anonymous username to 50 characters for long user ids", async () => {
    const longId = "a".repeat(80);
    await anonymizeUser(longId);

    expect(updateProfileByUserId).toHaveBeenCalledWith(
      longId,
      expect.objectContaining({
        username: expect.stringMatching(/^.{50}$/),
      }),
      undefined,
    );
  });

  it("forwards the transaction handle to every data call", async () => {
    const tx = { tag: "tx" } as never;
    await anonymizeUser("user-2", tx);

    expect(deleteSessionsByUserId).toHaveBeenCalledWith("user-2", tx);
    expect(deleteAccountsByUserId).toHaveBeenCalledWith("user-2", tx);
    expect(updateUserById).toHaveBeenCalledWith(
      "user-2",
      expect.any(Object),
      tx,
    );
    expect(updateProfileByUserId).toHaveBeenCalledWith(
      "user-2",
      expect.any(Object),
      tx,
    );
  });
});
