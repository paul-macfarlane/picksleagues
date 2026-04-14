"use server";

import { revalidatePath } from "next/cache";

import { withTransaction } from "@/data/utils";
import { getSession } from "@/lib/auth";
import { anonymizeUser } from "@/lib/account";
import type { ActionResult } from "@/lib/types";

export async function deleteAccountAction(): Promise<ActionResult> {
  const session = await getSession();

  await withTransaction((tx) => anonymizeUser(session.user.id, tx));

  revalidatePath("/", "layout");

  return { success: true, data: undefined };
}
