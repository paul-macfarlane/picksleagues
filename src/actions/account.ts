"use server";

import { redirect } from "next/navigation";

import { updateProfile } from "@/data/profiles";
import {
  deleteAccountsByUserId,
  deleteSessionsByUserId,
  updateUser,
} from "@/data/users";
import { withTransaction } from "@/data/utils";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";

export async function deleteAccount(): Promise<ActionResult> {
  const currentSession = await getSession();
  const userId = currentSession.user.id;

  // TODO: Add "sole commissioner of multi-member league" guard in Epic 5
  // when league membership data is available. For now, always allow.

  await withTransaction(async (tx) => {
    await updateProfile(
      userId,
      {
        username: `anonymous_${userId}`,
        name: "Anonymous User",
        avatarUrl: null,
        setupComplete: true,
      },
      tx,
    );

    await updateUser(
      userId,
      {
        name: "Anonymous User",
        email: `deleted_${userId}@anonymous`,
        image: null,
      },
      tx,
    );

    await deleteSessionsByUserId(userId, tx);
    await deleteAccountsByUserId(userId, tx);
  });

  redirect("/login");
}
