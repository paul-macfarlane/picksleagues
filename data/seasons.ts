import { and, desc, eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type { NewSeason, Season } from "@/lib/db/schema/sports";
import { seasons } from "@/lib/db/schema/sports";

export async function upsertSeason(
  data: Omit<NewSeason, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<Season> {
  const client = tx ?? db;
  const [result] = await client
    .insert(seasons)
    .values(data)
    .onConflictDoUpdate({
      target: [seasons.sportsLeagueId, seasons.year],
      set: {
        startDate: data.startDate,
        endDate: data.endDate,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getSeasonByLeagueAndYear(
  sportsLeagueId: string,
  year: number,
  tx?: Transaction,
): Promise<Season | null> {
  const client = tx ?? db;
  const result = await client.query.seasons.findFirst({
    where: and(
      eq(seasons.sportsLeagueId, sportsLeagueId),
      eq(seasons.year, year),
    ),
  });
  return result ?? null;
}

export async function removeSeason(
  seasonId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  await client.delete(seasons).where(eq(seasons.id, seasonId));
}

export async function getSeasonsBySportsLeague(
  sportsLeagueId: string,
  tx?: Transaction,
): Promise<Season[]> {
  const client = tx ?? db;
  return client
    .select()
    .from(seasons)
    .where(eq(seasons.sportsLeagueId, sportsLeagueId))
    .orderBy(desc(seasons.year));
}
