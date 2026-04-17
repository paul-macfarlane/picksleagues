import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeagueMember } from "@/lib/db/schema/leagues";
import type { Profile } from "@/lib/db/schema/profiles";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/data/profiles", () => ({
  getProfileByUserId: vi.fn(),
}));

vi.mock("@/data/members", () => ({
  getLeagueMember: vi.fn(),
}));

import { getLeagueMember } from "@/data/members";
import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";

import {
  assertAdmin,
  assertLeagueCommissioner,
  assertLeagueMember,
  requireAdminSession,
} from "./permissions";

function makeMember(role: LeagueMember["role"]): LeagueMember {
  return {
    id: "m-1",
    leagueId: "l-1",
    userId: "u-1",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

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

describe("assertLeagueMember", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws ForbiddenError when the user is not a member", async () => {
    vi.mocked(getLeagueMember).mockResolvedValue(null);
    await expect(assertLeagueMember("u-1", "l-1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("returns the member when they belong to the league", async () => {
    const member = makeMember("member");
    vi.mocked(getLeagueMember).mockResolvedValue(member);
    const result = await assertLeagueMember("u-1", "l-1");
    expect(result).toEqual(member);
  });
});

describe("assertLeagueCommissioner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws ForbiddenError when the user is not a member", async () => {
    vi.mocked(getLeagueMember).mockResolvedValue(null);
    await expect(assertLeagueCommissioner("u-1", "l-1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when the member is not a commissioner", async () => {
    vi.mocked(getLeagueMember).mockResolvedValue(makeMember("member"));
    await expect(assertLeagueCommissioner("u-1", "l-1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("returns the member when they are a commissioner", async () => {
    const commissioner = makeMember("commissioner");
    vi.mocked(getLeagueMember).mockResolvedValue(commissioner);
    const result = await assertLeagueCommissioner("u-1", "l-1");
    expect(result).toEqual(commissioner);
  });
});
