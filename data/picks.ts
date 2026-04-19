import { and, asc, eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type { Pick } from "@/lib/db/schema/picks";
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
