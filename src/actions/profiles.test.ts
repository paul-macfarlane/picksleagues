import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getProfileByUsername,
  updateProfile as updateProfileData,
} from "@/data/profiles";
import { updateProfile } from "./profiles";

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("@/data/profiles", () => ({
  getProfileByUsername: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates profile with valid data", async () => {
    (getProfileByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (updateProfileData as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await updateProfile({
      username: "newname",
      name: "New Name",
      avatarUrl: "",
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(updateProfileData).toHaveBeenCalledWith("user-1", {
      username: "newname",
      name: "New Name",
      avatarUrl: null,
    });
  });

  it("allows keeping own username", async () => {
    (getProfileByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user-1",
      username: "existing",
    });
    (updateProfileData as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await updateProfile({
      username: "existing",
      name: "Name",
    });

    expect(result.success).toBe(true);
  });

  it("returns error when username is taken by another user", async () => {
    (getProfileByUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "other-user",
      username: "taken",
    });

    const result = await updateProfile({
      username: "taken",
      name: "Name",
    });

    expect(result).toEqual({
      success: false,
      error: "Username is already taken",
    });
  });

  it("sets setupComplete when isSetup is true", async () => {
    (getProfileByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (updateProfileData as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await updateProfile({
      username: "newuser",
      name: "Name",
      isSetup: true,
    });

    expect(updateProfileData).toHaveBeenCalledWith("user-1", {
      username: "newuser",
      name: "Name",
      avatarUrl: null,
      setupComplete: true,
    });
  });

  it("does not set setupComplete when isSetup is absent", async () => {
    (getProfileByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (updateProfileData as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await updateProfile({
      username: "newuser",
      name: "Name",
    });

    expect(updateProfileData).toHaveBeenCalledWith("user-1", {
      username: "newuser",
      name: "Name",
      avatarUrl: null,
    });
  });
});
