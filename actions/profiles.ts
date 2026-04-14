"use server";

import { revalidatePath } from "next/cache";

import {
  getProfileByUserId,
  getProfileByUsername,
  updateProfileByUserId,
} from "@/data/profiles";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { updateProfileSchema } from "@/lib/validators/profiles";

type UpdateProfileOptions = { markSetupComplete?: boolean };

export async function updateProfileAction(
  input: unknown,
  options: UpdateProfileOptions = {},
): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid profile details.",
    };
  }

  const session = await getSession();

  const existing = await getProfileByUserId(session.user.id);
  if (!existing) {
    return {
      success: false,
      error: "Profile not found. Please sign out and back in.",
    };
  }

  const { username, name, avatarUrl } = parsed.data;
  const normalizedAvatarUrl = avatarUrl && avatarUrl !== "" ? avatarUrl : null;

  if (username !== existing.username) {
    const conflicting = await getProfileByUsername(username);
    if (conflicting && conflicting.userId !== session.user.id) {
      return { success: false, error: "That username is already taken." };
    }
  }

  await updateProfileByUserId(session.user.id, {
    username,
    name,
    avatarUrl: normalizedAvatarUrl,
    ...(options.markSetupComplete ? { setupComplete: true } : {}),
  });

  revalidatePath("/profile");
  revalidatePath("/", "layout");

  return { success: true, data: undefined };
}
