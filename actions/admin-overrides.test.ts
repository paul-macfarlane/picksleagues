import { beforeEach, describe, expect, it, vi } from "vitest";

import { toggleLockAction } from "@/actions/admin-overrides";
import {
  clearLockedEvent,
  clearLockedOdds,
  setLockedEvent,
  setLockedOdds,
} from "@/data/events";
import { clearLockedPhase, setLockedPhase } from "@/data/phases";
import { clearLockedTeam, setLockedTeam } from "@/data/teams";
import type { Profile } from "@/lib/db/schema/profiles";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { requireAdminSession } from "@/lib/permissions";

vi.mock("@/data/teams", () => ({
  setLockedTeam: vi.fn(),
  clearLockedTeam: vi.fn(),
}));

vi.mock("@/data/phases", () => ({
  setLockedPhase: vi.fn(),
  clearLockedPhase: vi.fn(),
}));

vi.mock("@/data/events", () => ({
  setLockedEvent: vi.fn(),
  clearLockedEvent: vi.fn(),
  setLockedOdds: vi.fn(),
  clearLockedOdds: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAdminSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { revalidatePath } = await import("next/cache");

const UUID = "11111111-1111-4111-8111-111111111111";

const ADMIN_PROFILE: Profile = {
  id: "profile-admin-1",
  userId: "admin-1",
  username: "admin",
  name: "Admin",
  avatarUrl: null,
  role: "admin",
  setupComplete: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdminSession).mockResolvedValue({
    userId: "admin-1",
    profile: ADMIN_PROFILE,
  });
});

describe("toggleLockAction", () => {
  it("rejects invalid input without calling auth", async () => {
    const result = await toggleLockAction({ entity: "bogus" });

    expect(result.success).toBe(false);
    expect(requireAdminSession).not.toHaveBeenCalled();
    expect(setLockedTeam).not.toHaveBeenCalled();
  });

  it("bubbles UnauthorizedError from requireAdminSession", async () => {
    vi.mocked(requireAdminSession).mockRejectedValueOnce(
      new UnauthorizedError(),
    );

    await expect(
      toggleLockAction({ entity: "team", id: UUID, locked: true }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("bubbles ForbiddenError from requireAdminSession", async () => {
    vi.mocked(requireAdminSession).mockRejectedValueOnce(new ForbiddenError());

    await expect(
      toggleLockAction({ entity: "team", id: UUID, locked: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("locks a team via setLockedTeam with the caller-supplied id", async () => {
    const result = await toggleLockAction({
      entity: "team",
      id: UUID,
      locked: true,
    });

    expect(result.success).toBe(true);
    expect(setLockedTeam).toHaveBeenCalledWith(UUID, expect.any(Date));
    expect(clearLockedTeam).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/admin/overrides");
  });

  it("unlocks a team via clearLockedTeam", async () => {
    const result = await toggleLockAction({
      entity: "team",
      id: UUID,
      locked: false,
    });

    expect(result.success).toBe(true);
    expect(clearLockedTeam).toHaveBeenCalledWith(UUID);
    expect(setLockedTeam).not.toHaveBeenCalled();
  });

  it("dispatches to the right helper per entity", async () => {
    await toggleLockAction({ entity: "phase", id: UUID, locked: true });
    expect(setLockedPhase).toHaveBeenCalledWith(UUID, expect.any(Date));

    await toggleLockAction({ entity: "phase", id: UUID, locked: false });
    expect(clearLockedPhase).toHaveBeenCalledWith(UUID);

    await toggleLockAction({ entity: "event", id: UUID, locked: true });
    expect(setLockedEvent).toHaveBeenCalledWith(UUID, expect.any(Date));

    await toggleLockAction({ entity: "event", id: UUID, locked: false });
    expect(clearLockedEvent).toHaveBeenCalledWith(UUID);

    await toggleLockAction({ entity: "odds", id: UUID, locked: true });
    expect(setLockedOdds).toHaveBeenCalledWith(UUID, expect.any(Date));

    await toggleLockAction({ entity: "odds", id: UUID, locked: false });
    expect(clearLockedOdds).toHaveBeenCalledWith(UUID);
  });

  it("returns { success: false } when the target is not found", async () => {
    vi.mocked(setLockedTeam).mockRejectedValueOnce(
      new NotFoundError("Team not found"),
    );

    const result = await toggleLockAction({
      entity: "team",
      id: UUID,
      locked: true,
    });

    expect(result).toEqual({ success: false, error: "Team not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("propagates unexpected errors", async () => {
    vi.mocked(setLockedTeam).mockRejectedValueOnce(new Error("boom"));

    await expect(
      toggleLockAction({ entity: "team", id: UUID, locked: true }),
    ).rejects.toThrow("boom");
  });
});
