import { eq, inArray } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type {
  ExternalEvent,
  ExternalPhase,
  ExternalSeason,
  ExternalSportsbook,
  ExternalTeam,
  NewExternalEvent,
  NewExternalPhase,
  NewExternalSeason,
  NewExternalSportsbook,
  NewExternalTeam,
} from "@/lib/db/schema/external";
import {
  externalEvents,
  externalPhases,
  externalSeasons,
  externalSportsbooks,
  externalTeams,
} from "@/lib/db/schema/external";

// --- Seasons ---

export async function upsertExternalSeason(
  data: Omit<NewExternalSeason, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<ExternalSeason> {
  const client = tx ?? db;
  const [result] = await client
    .insert(externalSeasons)
    .values(data)
    .onConflictDoUpdate({
      target: [externalSeasons.dataSourceId, externalSeasons.externalId],
      set: { seasonId: data.seasonId, updatedAt: new Date() },
    })
    .returning();
  return result;
}

// --- Phases ---

export async function upsertExternalPhase(
  data: Omit<NewExternalPhase, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<ExternalPhase> {
  const client = tx ?? db;
  const [result] = await client
    .insert(externalPhases)
    .values(data)
    .onConflictDoUpdate({
      target: [externalPhases.dataSourceId, externalPhases.externalId],
      set: { phaseId: data.phaseId, updatedAt: new Date() },
    })
    .returning();
  return result;
}

// --- Teams ---

export async function upsertExternalTeam(
  data: Omit<NewExternalTeam, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<ExternalTeam> {
  const client = tx ?? db;
  const [result] = await client
    .insert(externalTeams)
    .values(data)
    .onConflictDoUpdate({
      target: [externalTeams.dataSourceId, externalTeams.externalId],
      set: { teamId: data.teamId, updatedAt: new Date() },
    })
    .returning();
  return result;
}

export async function getAllExternalTeams(
  dataSourceId: string,
  tx?: Transaction,
): Promise<ExternalTeam[]> {
  const client = tx ?? db;
  return client.query.externalTeams.findMany({
    where: eq(externalTeams.dataSourceId, dataSourceId),
  });
}

// --- Events ---

export async function upsertExternalEvent(
  data: Omit<NewExternalEvent, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<ExternalEvent> {
  const client = tx ?? db;
  const [result] = await client
    .insert(externalEvents)
    .values(data)
    .onConflictDoUpdate({
      target: [externalEvents.dataSourceId, externalEvents.externalId],
      set: {
        eventId: data.eventId,
        oddsRef: data.oddsRef,
        statusRef: data.statusRef,
        homeScoreRef: data.homeScoreRef,
        awayScoreRef: data.awayScoreRef,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getAllExternalEvents(
  dataSourceId: string,
  tx?: Transaction,
): Promise<ExternalEvent[]> {
  const client = tx ?? db;
  return client.query.externalEvents.findMany({
    where: eq(externalEvents.dataSourceId, dataSourceId),
  });
}

export async function getExternalEventByEventId(
  eventId: string,
  tx?: Transaction,
): Promise<ExternalEvent | null> {
  const client = tx ?? db;
  const result = await client.query.externalEvents.findFirst({
    where: eq(externalEvents.eventId, eventId),
  });
  return result ?? null;
}

export async function getExternalEventsByEventIds(
  eventIds: string[],
  tx?: Transaction,
): Promise<ExternalEvent[]> {
  if (eventIds.length === 0) return [];
  const client = tx ?? db;
  return client.query.externalEvents.findMany({
    where: inArray(externalEvents.eventId, eventIds),
  });
}

// --- Sportsbooks ---

export async function upsertExternalSportsbook(
  data: Omit<NewExternalSportsbook, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<ExternalSportsbook> {
  const client = tx ?? db;
  const [result] = await client
    .insert(externalSportsbooks)
    .values(data)
    .onConflictDoUpdate({
      target: [
        externalSportsbooks.dataSourceId,
        externalSportsbooks.externalId,
      ],
      set: { sportsbookId: data.sportsbookId, updatedAt: new Date() },
    })
    .returning();
  return result;
}
