import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { NewProfile, Profile } from "@/lib/db/schema/profiles";
import { profile } from "@/lib/db/schema/profiles";

export async function insertProfile(
  data: NewProfile,
  tx?: Transaction,
): Promise<Profile> {
  const client = tx ?? db;
  const [result] = await client.insert(profile).values(data).returning();
  return result;
}

export async function getProfileByUserId(
  userId: string,
  tx?: Transaction,
): Promise<Profile | null> {
  const client = tx ?? db;
  const result = await client.query.profile.findFirst({
    where: eq(profile.userId, userId),
  });
  return result ?? null;
}

export async function getProfileByUsername(
  username: string,
  tx?: Transaction,
): Promise<Profile | null> {
  const client = tx ?? db;
  const result = await client.query.profile.findFirst({
    where: eq(profile.username, username),
  });
  return result ?? null;
}

export async function updateProfileByUserId(
  userId: string,
  data: Partial<NewProfile>,
  tx?: Transaction,
): Promise<Profile> {
  const client = tx ?? db;
  const [result] = await client
    .update(profile)
    .set(data)
    .where(eq(profile.userId, userId))
    .returning();
  if (!result) {
    throw new NotFoundError("Profile not found");
  }
  return result;
}
