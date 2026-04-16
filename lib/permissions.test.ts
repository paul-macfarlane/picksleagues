import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Profile } from "@/lib/db/schema/profiles";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/data/profiles", () => ({
  getProfileByUserId: vi.fn(),
}));

import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";

import { assertAdmin, requireAdminSession } from "./permissions";

function makeProfile(role: Profile["role"]): Profile {
  return {
    id: "p-1",
    userId: "u-1",
    username: "alice",
    name: "Alice",
    avatarUrl: null,
    role,
    setupComplete: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("assertAdmin", () => {
  it("allows admin role", () => {
    expect(() => assertAdmin(makeProfile("admin"))).not.toThrow();
  });

  it("throws ForbiddenError for user role", () => {
    expect(() => assertAdmin(makeProfile("user"))).toThrow(ForbiddenError);
  });
});

describe("requireAdminSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u-1" },
    } as Awaited<ReturnType<typeof getSession>>);
  });

  it("throws UnauthorizedError when session is missing", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new UnauthorizedError());
    await expect(requireAdminSession()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("throws NotFoundError when profile is missing", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(null);
    await expect(requireAdminSession()).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError for non-admin profile", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(makeProfile("user"));
    await expect(requireAdminSession()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns userId and profile for an admin", async () => {
    const profile = makeProfile("admin");
    vi.mocked(getProfileByUserId).mockResolvedValue(profile);
    const result = await requireAdminSession();
    expect(result).toEqual({ userId: "u-1", profile });
  });
});
