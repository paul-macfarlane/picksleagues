import { eq, isNotNull } from "drizzle-orm";

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

export async function getTeamById(
  teamId: string,
  tx?: Transaction,
): Promise<Team | null> {
  const client = tx ?? db;
  const result = await client.query.teams.findFirst({
    where: eq(teams.id, teamId),
  });
  return result ?? null;
}

export async function getTeamsBySportsLeague(
  sportsLeagueId: string,
  tx?: Transaction,
): Promise<Team[]> {
  const client = tx ?? db;
  return client
    .select()
    .from(teams)
    .where(eq(teams.sportsLeagueId, sportsLeagueId));
}

export async function setLockedTeam(
  teamId: string,
  lockedAt: Date,
  tx?: Transaction,
): Promise<Team> {
  const client = tx ?? db;
  const [result] = await client
    .update(teams)
    .set({ lockedAt, updatedAt: new Date() })
    .where(eq(teams.id, teamId))
    .returning();
  if (!result) {
    throw new NotFoundError("Team not found");
  }
  return result;
}

export async function clearLockedTeam(
  teamId: string,
  tx?: Transaction,
): Promise<Team> {
  const client = tx ?? db;
  const [result] = await client
    .update(teams)
    .set({ lockedAt: null, updatedAt: new Date() })
    .where(eq(teams.id, teamId))
    .returning();
  if (!result) {
    throw new NotFoundError("Team not found");
  }
  return result;
}

export async function getLockedTeamIds(tx?: Transaction): Promise<Set<string>> {
  const client = tx ?? db;
  const rows = await client
    .select({ id: teams.id })
    .from(teams)
    .where(isNotNull(teams.lockedAt));
  return new Set(rows.map((r) => r.id));
}
