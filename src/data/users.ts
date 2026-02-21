import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type { NewUser, User } from "@/lib/db/schema/auth";
import { account, session, user } from "@/lib/db/schema/auth";

export async function updateUser(
  userId: string,
  data: Partial<Pick<NewUser, "name" | "email" | "image">>,
  tx?: Transaction,
): Promise<User> {
  const client = tx ?? db;
  const [result] = await client
    .update(user)
    .set(data)
    .where(eq(user.id, userId))
    .returning();
  return result;
}

export async function deleteSessionsByUserId(
  userId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  await client.delete(session).where(eq(session.userId, userId));
}

export async function deleteAccountsByUserId(
  userId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  await client.delete(account).where(eq(account.userId, userId));
}
