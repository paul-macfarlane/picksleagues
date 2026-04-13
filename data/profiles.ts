import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
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
