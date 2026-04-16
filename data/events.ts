import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { Event, NewEvent, NewOdds, Odds } from "@/lib/db/schema/sports";
import { events, odds } from "@/lib/db/schema/sports";

export async function insertEvent(
  data: Omit<NewEvent, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<Event> {
  const client = tx ?? db;
  const [result] = await client.insert(events).values(data).returning();
  return result;
}

export async function updateEvent(
  eventId: string,
  data: Partial<Omit<NewEvent, "id" | "createdAt" | "updatedAt">>,
  tx?: Transaction,
): Promise<Event> {
  const client = tx ?? db;
  const [result] = await client
    .update(events)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(events.id, eventId))
    .returning();
  if (!result) {
    throw new NotFoundError("Event not found");
  }
  return result;
}

export async function upsertOdds(
  data: Omit<NewOdds, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<Odds> {
  const client = tx ?? db;
  const [result] = await client
    .insert(odds)
    .values(data)
    .onConflictDoUpdate({
      target: [odds.eventId, odds.sportsbookId],
      set: {
        homeSpread: data.homeSpread,
        awaySpread: data.awaySpread,
        homeMoneyline: data.homeMoneyline,
        awayMoneyline: data.awayMoneyline,
        overUnder: data.overUnder,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}
