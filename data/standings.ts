import { and, eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type {
  LeagueStanding,
  NewLeagueStanding,
} from "@/lib/db/schema/leagues";
import { leagueStandings } from "@/lib/db/schema/leagues";

export async function insertLeagueStanding(
  data: Omit<NewLeagueStanding, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<LeagueStanding> {
  const client = tx ?? db;
  const [result] = await client
    .insert(leagueStandings)
    .values(data)
    .returning();
  return result;
}

export async function getLeagueStanding(
  leagueId: string,
  userId: string,
  seasonId: string,
  tx?: Transaction,
): Promise<LeagueStanding | null> {
  const client = tx ?? db;
  const result = await client.query.leagueStandings.findFirst({
    where: and(
      eq(leagueStandings.leagueId, leagueId),
      eq(leagueStandings.userId, userId),
      eq(leagueStandings.seasonId, seasonId),
    ),
  });
  return result ?? null;
}
