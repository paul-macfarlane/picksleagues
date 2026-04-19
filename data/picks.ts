import { and, asc, eq, inArray } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type { NewPick, Pick } from "@/lib/db/schema/picks";
import { picks } from "@/lib/db/schema/picks";

export async function getPicksForLeaguePhase(
  leagueId: string,
  userId: string,
  phaseId: string,
  tx?: Transaction,
): Promise<Pick[]> {
  const client = tx ?? db;
  return client
    .select()
    .from(picks)
    .where(
      and(
        eq(picks.leagueId, leagueId),
        eq(picks.userId, userId),
        eq(picks.phaseId, phaseId),
      ),
    )
    .orderBy(asc(picks.createdAt));
}

export async function insertPicks(
  data: Omit<NewPick, "id" | "createdAt" | "updatedAt">[],
  tx?: Transaction,
): Promise<Pick[]> {
  if (data.length === 0) return [];
  const client = tx ?? db;
  return client.insert(picks).values(data).returning();
}

export async function deleteUserPicksForEvents(
  leagueId: string,
  userId: string,
  eventIds: string[],
  tx?: Transaction,
): Promise<void> {
  if (eventIds.length === 0) return;
  const client = tx ?? db;
  await client
    .delete(picks)
    .where(
      and(
        eq(picks.leagueId, leagueId),
        eq(picks.userId, userId),
        inArray(picks.eventId, eventIds),
      ),
    );
}
