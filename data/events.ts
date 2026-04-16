import { and, eq, isNotNull, ne } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type {
  Event,
  EventStatus,
  NewEvent,
  NewOdds,
  Odds,
} from "@/lib/db/schema/sports";
import { events, odds, phases } from "@/lib/db/schema/sports";
import { externalEvents } from "@/lib/db/schema/external";

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

export interface ScorableEvent {
  eventId: string;
  status: EventStatus;
  startTime: Date;
  statusRef: string;
  homeScoreRef: string;
  awayScoreRef: string;
}

export interface OddsSyncableEvent {
  eventId: string;
  startTime: Date;
  oddsRef: string;
}

export async function getOddsSyncableEvents(
  dataSourceId: string,
  tx?: Transaction,
): Promise<OddsSyncableEvent[]> {
  const client = tx ?? db;
  const rows = await client
    .select({
      eventId: events.id,
      startTime: events.startTime,
      oddsRef: externalEvents.oddsRef,
    })
    .from(events)
    .innerJoin(externalEvents, eq(events.id, externalEvents.eventId))
    .where(
      and(
        eq(externalEvents.dataSourceId, dataSourceId),
        eq(events.status, "not_started"),
        isNotNull(externalEvents.oddsRef),
      ),
    );

  // WHERE clause guarantees oddsRef is non-null
  return rows as OddsSyncableEvent[];
}

export async function getScorableEvents(
  dataSourceId: string,
  tx?: Transaction,
): Promise<ScorableEvent[]> {
  const client = tx ?? db;
  const rows = await client
    .select({
      eventId: events.id,
      status: events.status,
      startTime: events.startTime,
      statusRef: externalEvents.statusRef,
      homeScoreRef: externalEvents.homeScoreRef,
      awayScoreRef: externalEvents.awayScoreRef,
    })
    .from(events)
    .innerJoin(externalEvents, eq(events.id, externalEvents.eventId))
    .where(
      and(
        eq(externalEvents.dataSourceId, dataSourceId),
        ne(events.status, "final"),
        isNotNull(externalEvents.statusRef),
        isNotNull(externalEvents.homeScoreRef),
        isNotNull(externalEvents.awayScoreRef),
      ),
    );

  // WHERE clause guarantees statusRef, homeScoreRef, awayScoreRef are non-null
  return rows as ScorableEvent[];
}

export async function getScorableEventsForPhase(
  phaseId: string,
  dataSourceId: string,
  tx?: Transaction,
): Promise<ScorableEvent[]> {
  const client = tx ?? db;
  const rows = await client
    .select({
      eventId: events.id,
      status: events.status,
      startTime: events.startTime,
      statusRef: externalEvents.statusRef,
      homeScoreRef: externalEvents.homeScoreRef,
      awayScoreRef: externalEvents.awayScoreRef,
    })
    .from(events)
    .innerJoin(externalEvents, eq(events.id, externalEvents.eventId))
    .where(
      and(
        eq(events.phaseId, phaseId),
        eq(externalEvents.dataSourceId, dataSourceId),
        ne(events.status, "final"),
        isNotNull(externalEvents.statusRef),
        isNotNull(externalEvents.homeScoreRef),
        isNotNull(externalEvents.awayScoreRef),
      ),
    );

  // WHERE clause guarantees statusRef, homeScoreRef, awayScoreRef are non-null
  return rows as ScorableEvent[];
}

export interface SeasonEventSummary {
  id: string;
  phaseId: string;
  status: EventStatus;
}

export async function getEventsBySeason(
  seasonId: string,
  tx?: Transaction,
): Promise<SeasonEventSummary[]> {
  const client = tx ?? db;
  return client
    .select({
      id: events.id,
      phaseId: events.phaseId,
      status: events.status,
    })
    .from(events)
    .innerJoin(phases, eq(events.phaseId, phases.id))
    .where(eq(phases.seasonId, seasonId));
}
