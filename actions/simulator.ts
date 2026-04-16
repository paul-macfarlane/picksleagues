"use server";

import { revalidatePath } from "next/cache";

import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { assertAdmin } from "@/lib/permissions";
import { advancePhase, initializeSeason, resetSeason } from "@/lib/simulator";
import type { ActionResult } from "@/lib/types";
import { initializeSimulatorSchema } from "@/lib/validators/simulator";

const SIMULATOR_PATH = "/admin/simulator";

async function assertCallerIsAdmin(): Promise<void> {
  const session = await getSession();
  const profile = await getProfileByUserId(session.user.id);
  if (!profile) throw new NotFoundError("Profile not found");
  assertAdmin(profile);
}

export async function initializeSimulatorAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = initializeSimulatorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  await assertCallerIsAdmin();

  try {
    await initializeSeason(parsed.data.year);
  } catch (err) {
    if (err instanceof BadRequestError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath(SIMULATOR_PATH);
  return { success: true, data: undefined };
}

export async function advancePhaseAction(): Promise<ActionResult> {
  await assertCallerIsAdmin();

  try {
    await advancePhase();
  } catch (err) {
    if (err instanceof BadRequestError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath(SIMULATOR_PATH);
  return { success: true, data: undefined };
}

export async function resetSimulatorAction(): Promise<ActionResult> {
  await assertCallerIsAdmin();

  await resetSeason();

  revalidatePath(SIMULATOR_PATH);
  return { success: true, data: undefined };
}
