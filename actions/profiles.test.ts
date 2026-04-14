import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "@/lib/errors";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/data/profiles", () => ({
  getProfileByUserId: vi.fn(),
  getProfileByUsername: vi.fn(),
  updateProfileByUserId: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

import {
  getProfileByUserId,
  getProfileByUsername,
  updateProfileByUserId,
} from "@/data/profiles";
import { getSession } from "@/lib/auth";

import { updateProfileAction } from "./profiles";

const validInput = {
  username: "paul1234",
  name: "Paul M",
  avatarUrl: "https://example.com/a.png",
};

const session = { user: { id: "user-1" } };
const existingProfile = {
  id: "profile-1",
  userId: "user-1",
  username: "paul1234",
  name: "Paul M",
  avatarUrl: null,
  role: "user" as const,
  setupComplete: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(
    session as Awaited<ReturnType<typeof getSession>>,
  );
  vi.mocked(getProfileByUserId).mockResolvedValue(existingProfile);
  vi.mocked(getProfileByUsername).mockResolvedValue(null);
  vi.mocked(updateProfileByUserId).mockResolvedValue(existingProfile);
});

describe("updateProfileAction", () => {
  it("returns an error when validation fails and does not hit the data layer", async () => {
    const result = await updateProfileAction({
      ...validInput,
      username: "ab",
    });
    expect(result.success).toBe(false);
    expect(updateProfileByUserId).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when there is no session", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new UnauthorizedError());
    await expect(updateProfileAction(validInput)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("updates the current user's profile on success", async () => {
    const result = await updateProfileAction(validInput);
    expect(result.success).toBe(true);
    expect(updateProfileByUserId).toHaveBeenCalledWith("user-1", {
      username: validInput.username,
      name: validInput.name,
      avatarUrl: validInput.avatarUrl,
    });
  });

  it("marks setup complete when the option is set", async () => {
    await updateProfileAction(validInput, { markSetupComplete: true });
    expect(updateProfileByUserId).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ setupComplete: true }),
    );
  });

  it("writes null when the avatar URL is omitted", async () => {
    await updateProfileAction({
      username: validInput.username,
      name: validInput.name,
    });
    expect(updateProfileByUserId).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ avatarUrl: null }),
    );
  });

  it("skips the uniqueness pre-check when the username is unchanged", async () => {
    await updateProfileAction(validInput);
    expect(getProfileByUsername).not.toHaveBeenCalled();
  });

  it("returns a friendly error when another user already owns the username", async () => {
    vi.mocked(getProfileByUsername).mockResolvedValueOnce({
      ...existingProfile,
      id: "profile-2",
      userId: "user-2",
      username: "newname",
    });
    const result = await updateProfileAction({
      ...validInput,
      username: "newname",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already taken/i);
    }
    expect(updateProfileByUserId).not.toHaveBeenCalled();
  });

  it("allows a rename when no other profile owns the username", async () => {
    vi.mocked(getProfileByUsername).mockResolvedValueOnce(null);
    const result = await updateProfileAction({
      ...validInput,
      username: "newname",
    });
    expect(result.success).toBe(true);
    expect(updateProfileByUserId).toHaveBeenCalled();
  });
});
