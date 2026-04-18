"use server";

import { revalidatePath } from "next/cache";

import { getLeagueMembershipSummaryForUser } from "@/data/members";
import { withTransaction } from "@/data/utils";
import { anonymizeUser, getSoleCommissionerBlockers } from "@/lib/account";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";

export async function deleteAccountAction(): Promise<ActionResult> {
  const session = await getSession();

  const summary = await getLeagueMembershipSummaryForUser(session.user.id);
  const blockers = getSoleCommissionerBlockers(summary);
  if (blockers.length > 0) {
    const names = blockers.map((b) => b.leagueName).join(", ");
    return {
      success: false,
      error: `Promote another commissioner in ${names} before deleting your account — you're the only one running it.`,
    };
  }

  await withTransaction((tx) => anonymizeUser(session.user.id, summary, tx));

  revalidatePath("/", "layout");

  return { success: true, data: undefined };
}
