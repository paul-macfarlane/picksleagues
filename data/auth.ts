import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { account, session } from "@/lib/db/schema/auth";

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
