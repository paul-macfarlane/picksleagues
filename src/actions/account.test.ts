import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateProfile } from "@/data/profiles";
import {
  deleteAccountsByUserId,
  deleteSessionsByUserId,
  updateUser,
} from "@/data/users";
import { deleteAccount } from "./account";

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("@/data/profiles", () => ({
  updateProfile: vi.fn(),
}));

vi.mock("@/data/users", () => ({
  updateUser: vi.fn(),
  deleteSessionsByUserId: vi.fn(),
  deleteAccountsByUserId: vi.fn(),
}));

vi.mock("@/data/utils", () => ({
  withTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn("mock-tx"),
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("deleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("anonymizes profile data", async () => {
    await deleteAccount();

    expect(updateProfile).toHaveBeenCalledWith(
      "user-1",
      {
        username: "anonymous_user-1",
        name: "Anonymous User",
        avatarUrl: null,
        setupComplete: true,
      },
      "mock-tx",
    );
  });

  it("anonymizes user record", async () => {
    await deleteAccount();

    expect(updateUser).toHaveBeenCalledWith(
      "user-1",
      {
        name: "Anonymous User",
        email: "deleted_user-1@anonymous",
        image: null,
      },
      "mock-tx",
    );
  });

  it("deletes auth sessions and accounts", async () => {
    await deleteAccount();

    expect(deleteSessionsByUserId).toHaveBeenCalledWith("user-1", "mock-tx");
    expect(deleteAccountsByUserId).toHaveBeenCalledWith("user-1", "mock-tx");
  });

  it("redirects to login after deletion", async () => {
    await deleteAccount();

    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
