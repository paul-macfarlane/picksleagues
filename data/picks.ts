import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type { NewPick, Pick, PickResult } from "@/lib/db/schema/picks";
import { picks } from "@/lib/db/schema/picks";
import type { Event } from "@/lib/db/schema/sports";
import { events, phases } from "@/lib/db/schema/sports";

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

export interface PickWithEvent {
  pick: Pick;
  event: Event;
}

export async function getPicksForLeagueSeasonWithEvent(
  leagueId: string,
  seasonId: string,
  tx?: Transaction,
): Promise<PickWithEvent[]> {
  const client = tx ?? db;
  const rows = await client
    .select({ pick: picks, event: events })
    .from(picks)
    .innerJoin(events, eq(picks.eventId, events.id))
    .innerJoin(phases, eq(picks.phaseId, phases.id))
    .where(and(eq(picks.leagueId, leagueId), eq(phases.seasonId, seasonId)));
  return rows;
}

export interface PickResultUpdate {
  id: string;
  pickResult: PickResult | null;
}

export async function updatePickResults(
  updates: PickResultUpdate[],
  tx?: Transaction,
): Promise<void> {
  if (updates.length === 0) return;
  const client = tx ?? db;
  // Batch update via one statement per distinct target value (at most 4:
  // win/loss/push/null). Each runs against the subset of ids with that
  // target — still one round trip per bucket, not per pick.
  const byTarget = new Map<PickResult | null, string[]>();
  for (const update of updates) {
    const bucket = byTarget.get(update.pickResult) ?? [];
    bucket.push(update.id);
    byTarget.set(update.pickResult, bucket);
  }
  for (const [result, ids] of byTarget) {
    await client
      .update(picks)
      .set({ pickResult: result, updatedAt: new Date() })
      .where(inArray(picks.id, ids));
  }
}

export async function clearPickResultsForEvent(
  eventId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  await client
    .update(picks)
    .set({ pickResult: null, updatedAt: new Date() })
    .where(eq(picks.eventId, eventId));
}

export interface LeagueSeasonPair {
  leagueId: string;
  seasonId: string;
}

export async function getLeagueSeasonPairsForEvent(
  eventId: string,
  tx?: Transaction,
): Promise<LeagueSeasonPair[]> {
  const client = tx ?? db;
  const rows = await client
    .selectDistinct({
      leagueId: picks.leagueId,
      seasonId: phases.seasonId,
    })
    .from(picks)
    .innerJoin(phases, eq(picks.phaseId, phases.id))
    .where(eq(picks.eventId, eventId));
  return rows;
}

export async function getLeagueSeasonPairsWithUnscoredFinalPicks(
  tx?: Transaction,
): Promise<LeagueSeasonPair[]> {
  const client = tx ?? db;
  const rows = await client
    .selectDistinct({
      leagueId: picks.leagueId,
      seasonId: phases.seasonId,
    })
    .from(picks)
    .innerJoin(events, eq(picks.eventId, events.id))
    .innerJoin(phases, eq(picks.phaseId, phases.id))
    .where(and(isNull(picks.pickResult), eq(events.status, "final")));
  return rows;
}
