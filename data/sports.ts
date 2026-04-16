import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
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

export async function getDataSourceByName(
  name: string,
  tx?: Transaction,
): Promise<DataSource> {
  const client = tx ?? db;
  const result = await client.query.dataSources.findFirst({
    where: eq(dataSources.name, name),
  });
  if (!result) {
    throw new NotFoundError(`Data source "${name}" not found`);
  }
  return result;
}

export async function getSportsbookByName(
  name: string,
  tx?: Transaction,
): Promise<Sportsbook> {
  const client = tx ?? db;
  const result = await client.query.sportsbooks.findFirst({
    where: eq(sportsbooks.name, name),
  });
  if (!result) {
    throw new NotFoundError(`Sportsbook "${name}" not found`);
  }
  return result;
}

export async function getSportsLeagueByAbbreviation(
  abbreviation: string,
  tx?: Transaction,
): Promise<SportsLeague> {
  const client = tx ?? db;
  const result = await client.query.sportsLeagues.findFirst({
    where: eq(sportsLeagues.abbreviation, abbreviation),
  });
  if (!result) {
    throw new NotFoundError(
      `Sports league with abbreviation "${abbreviation}" not found`,
    );
  }
  return result;
}

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
