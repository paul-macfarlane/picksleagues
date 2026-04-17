import { and, desc, eq, inArray } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { League, NewLeague } from "@/lib/db/schema/leagues";
import { leagueMembers, leagues } from "@/lib/db/schema/leagues";

export async function insertLeague(
  data: Omit<NewLeague, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<League> {
  const client = tx ?? db;
  const [result] = await client.insert(leagues).values(data).returning();
  return result;
}

export async function getLeagueById(
  leagueId: string,
  tx?: Transaction,
): Promise<League | null> {
  const client = tx ?? db;
  const result = await client.query.leagues.findFirst({
    where: eq(leagues.id, leagueId),
  });
  return result ?? null;
}

export async function updateLeague(
  leagueId: string,
  data: Partial<Omit<NewLeague, "id" | "createdAt" | "updatedAt">>,
  tx?: Transaction,
): Promise<League> {
  const client = tx ?? db;
  const [result] = await client
    .update(leagues)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(leagues.id, leagueId))
    .returning();
  if (!result) {
    throw new NotFoundError("League not found");
  }
  return result;
}

export async function removeLeague(
  leagueId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  const deleted = await client
    .delete(leagues)
    .where(eq(leagues.id, leagueId))
    .returning({ id: leagues.id });
  if (deleted.length === 0) {
    throw new NotFoundError("League not found");
  }
}

export interface LeagueWithMemberCount extends League {
  memberCount: number;
}

export async function getLeaguesForUser(
  userId: string,
  tx?: Transaction,
): Promise<LeagueWithMemberCount[]> {
  const client = tx ?? db;
  const rows = await client
    .select({ leagueId: leagueMembers.leagueId })
    .from(leagueMembers)
    .where(eq(leagueMembers.userId, userId));
  const leagueIds = rows.map((r) => r.leagueId);
  if (leagueIds.length === 0) return [];

  const leagueRows = await client
    .select()
    .from(leagues)
    .where(inArray(leagues.id, leagueIds))
    .orderBy(desc(leagues.createdAt));

  const memberRows = await client
    .select({
      leagueId: leagueMembers.leagueId,
    })
    .from(leagueMembers)
    .where(inArray(leagueMembers.leagueId, leagueIds));

  const counts = new Map<string, number>();
  for (const row of memberRows) {
    counts.set(row.leagueId, (counts.get(row.leagueId) ?? 0) + 1);
  }

  return leagueRows.map((league) => ({
    ...league,
    memberCount: counts.get(league.id) ?? 0,
  }));
}

export async function getLeagueMemberCount(
  leagueId: string,
  tx?: Transaction,
): Promise<number> {
  const client = tx ?? db;
  const rows = await client
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, leagueId));
  return rows.length;
}

export async function isUserLeagueMember(
  userId: string,
  leagueId: string,
  tx?: Transaction,
): Promise<boolean> {
  const client = tx ?? db;
  const row = await client
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.userId, userId),
        eq(leagueMembers.leagueId, leagueId),
      ),
    )
    .limit(1);
  return row.length > 0;
}
