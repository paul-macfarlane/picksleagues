import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { NewUser, User } from "@/lib/db/schema/auth";
import { user } from "@/lib/db/schema/auth";

export async function updateUserById(
  userId: string,
  data: Partial<NewUser>,
  tx?: Transaction,
): Promise<User> {
  const client = tx ?? db;
  const [result] = await client
    .update(user)
    .set(data)
    .where(eq(user.id, userId))
    .returning();
  if (!result) {
    throw new NotFoundError("User not found");
  }
  return result;
}
