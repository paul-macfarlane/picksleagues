"use server";

import { revalidatePath } from "next/cache";

import { BadRequestError } from "@/lib/errors";
import { requireAdminSession } from "@/lib/permissions";
import { advancePhase, initializeSeason, resetSeason } from "@/lib/simulator";
import type { ActionResult } from "@/lib/types";
import { initializeSimulatorSchema } from "@/lib/validators/simulator";

const SIMULATOR_PATH = "/admin/simulator";

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

  await requireAdminSession();

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
  await requireAdminSession();

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
  await requireAdminSession();

  await resetSeason();

  revalidatePath(SIMULATOR_PATH);
  return { success: true, data: undefined };
}
