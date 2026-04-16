import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Profile } from "@/lib/db/schema/profiles";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "@/lib/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/data/profiles", () => ({
  getProfileByUserId: vi.fn(),
}));

vi.mock("@/lib/simulator", () => ({
  initializeSeason: vi.fn(),
  advancePhase: vi.fn(),
  resetSeason: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
import { advancePhase, initializeSeason, resetSeason } from "@/lib/simulator";

import {
  advancePhaseAction,
  initializeSimulatorAction,
  resetSimulatorAction,
} from "./simulator";

const ADMIN_PROFILE: Profile = {
  id: "p-1",
  userId: "user-1",
  username: "admin",
  name: "Admin",
  avatarUrl: null,
  role: "admin",
  setupComplete: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const USER_PROFILE: Profile = { ...ADMIN_PROFILE, role: "user" };

const SESSION = { user: { id: "user-1" } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue(
    SESSION as Awaited<ReturnType<typeof getSession>>,
  );
  vi.mocked(getProfileByUserId).mockResolvedValue(ADMIN_PROFILE);
});

describe("initializeSimulatorAction", () => {
  it("returns a validation error for non-numeric input", async () => {
    const result = await initializeSimulatorAction({ year: "abc" });
    expect(result.success).toBe(false);
    expect(initializeSeason).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when no session", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new UnauthorizedError());
    await expect(
      initializeSimulatorAction({ year: 2023 }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(initializeSeason).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError for non-admin caller", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(USER_PROFILE);
    await expect(
      initializeSimulatorAction({ year: 2023 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(initializeSeason).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when profile is missing", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(null);
    await expect(
      initializeSimulatorAction({ year: 2023 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns a business error when simulator throws BadRequestError (e.g., year out of range)", async () => {
    vi.mocked(initializeSeason).mockRejectedValue(
      new BadRequestError("Year must be within the last 6 years"),
    );
    const result = await initializeSimulatorAction({ year: 2010 });
    expect(result).toEqual({
      success: false,
      error: "Year must be within the last 6 years",
    });
  });

  it("propagates unexpected errors", async () => {
    vi.mocked(initializeSeason).mockRejectedValue(new Error("ESPN 500"));
    await expect(initializeSimulatorAction({ year: 2023 })).rejects.toThrow(
      "ESPN 500",
    );
  });

  it("initializes and revalidates on success", async () => {
    const result = await initializeSimulatorAction({ year: 2023 });
    expect(result).toEqual({ success: true, data: undefined });
    expect(initializeSeason).toHaveBeenCalledWith(2023);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/simulator");
  });
});

describe("advancePhaseAction", () => {
  it("throws ForbiddenError for non-admin", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(USER_PROFILE);
    await expect(advancePhaseAction()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns a business error when simulator throws BadRequestError", async () => {
    vi.mocked(advancePhase).mockRejectedValue(
      new BadRequestError("No active phase"),
    );
    const result = await advancePhaseAction();
    expect(result).toEqual({ success: false, error: "No active phase" });
  });

  it("advances and revalidates on success", async () => {
    const result = await advancePhaseAction();
    expect(result.success).toBe(true);
    expect(advancePhase).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/admin/simulator");
  });
});

describe("resetSimulatorAction", () => {
  it("throws ForbiddenError for non-admin", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(USER_PROFILE);
    await expect(resetSimulatorAction()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resets and revalidates on success", async () => {
    const result = await resetSimulatorAction();
    expect(result.success).toBe(true);
    expect(resetSeason).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/admin/simulator");
  });
});
