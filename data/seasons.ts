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
