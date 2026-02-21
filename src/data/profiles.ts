import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type { NewProfile, Profile } from "@/lib/db/schema/profiles";
import { profile } from "@/lib/db/schema/profiles";

export async function getProfileByUserId(
  userId: string,
): Promise<Profile | undefined> {
  return db.query.profile.findFirst({
    where: eq(profile.userId, userId),
  });
}

export async function getProfileByUsername(
  username: string,
): Promise<Profile | undefined> {
  return db.query.profile.findFirst({
    where: eq(profile.username, username),
  });
}

export async function insertProfile(
  data: NewProfile,
  tx?: Transaction,
): Promise<Profile> {
  const client = tx ?? db;
  const [result] = await client.insert(profile).values(data).returning();
  return result;
}

export async function updateProfile(
  userId: string,
  data: Partial<
    Pick<NewProfile, "username" | "name" | "avatarUrl" | "setupComplete">
  >,
  tx?: Transaction,
): Promise<Profile> {
  const client = tx ?? db;
  const [result] = await client
    .update(profile)
    .set(data)
    .where(eq(profile.userId, userId))
    .returning();
  return result;
}
