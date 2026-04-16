import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type {
  DataSource,
  NewSportsLeague,
  Sportsbook,
  SportsLeague,
} from "@/lib/db/schema/sports";
import {
  dataSources,
  sportsbooks,
  sportsLeagues,
} from "@/lib/db/schema/sports";

export async function upsertDataSource(
  data: { name: string },
  tx?: Transaction,
): Promise<DataSource> {
  const client = tx ?? db;
  const [result] = await client
    .insert(dataSources)
    .values(data)
    .onConflictDoUpdate({
      target: dataSources.name,
      set: { updatedAt: new Date() },
    })
    .returning();
  return result;
}

export async function upsertSportsbook(
  data: { name: string },
  tx?: Transaction,
): Promise<Sportsbook> {
  const client = tx ?? db;
  const [result] = await client
    .insert(sportsbooks)
    .values(data)
    .onConflictDoUpdate({
      target: sportsbooks.name,
      set: { updatedAt: new Date() },
    })
    .returning();
  return result;
}

export async function upsertSportsLeague(
  data: Omit<NewSportsLeague, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<SportsLeague> {
  const client = tx ?? db;
  const [result] = await client
    .insert(sportsLeagues)
    .values(data)
    .onConflictDoUpdate({
      target: sportsLeagues.abbreviation,
      set: { name: data.name, sport: data.sport, updatedAt: new Date() },
    })
    .returning();
  return result;
}
