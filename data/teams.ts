import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { NewTeam, Team } from "@/lib/db/schema/sports";
import { teams } from "@/lib/db/schema/sports";

export async function insertTeam(
  data: Omit<NewTeam, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<Team> {
  const client = tx ?? db;
  const [result] = await client.insert(teams).values(data).returning();
  return result;
}

export async function updateTeam(
  teamId: string,
  data: Partial<Omit<NewTeam, "id" | "createdAt" | "updatedAt">>,
  tx?: Transaction,
): Promise<Team> {
  const client = tx ?? db;
  const [result] = await client
    .update(teams)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(teams.id, teamId))
    .returning();
  if (!result) {
    throw new NotFoundError("Team not found");
  }
  return result;
}
