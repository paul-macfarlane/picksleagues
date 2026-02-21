"use server";

import { revalidatePath } from "next/cache";

import {
  getProfileByUsername,
  updateProfile as updateProfileData,
} from "@/data/profiles";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { UpdateProfileSchema } from "@/lib/validators/profiles";

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const validated = UpdateProfileSchema.parse(input);
  const session = await getSession();
  const userId = session.user.id;

  const existing = await getProfileByUsername(validated.username);
  if (existing && existing.userId !== userId) {
    return { success: false, error: "Username is already taken" };
  }

  await updateProfileData(userId, {
    username: validated.username,
    name: validated.name,
    avatarUrl: validated.avatarUrl || null,
    ...(validated.isSetup ? { setupComplete: true } : {}),
  });

  revalidatePath("/profile");
  if (validated.isSetup) {
    revalidatePath("/");
  }

  return { success: true, data: undefined };
}
