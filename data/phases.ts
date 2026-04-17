import { and, asc, eq, gt, lte } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { NewPhase, Phase } from "@/lib/db/schema/sports";
import { phases, seasons } from "@/lib/db/schema/sports";

export async function upsertPhase(
  data: Omit<NewPhase, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<Phase> {
  const client = tx ?? db;
  const [result] = await client
    .insert(phases)
    .values(data)
    .onConflictDoUpdate({
      target: [phases.seasonId, phases.seasonType, phases.weekNumber],
      set: {
        label: data.label,
        startDate: data.startDate,
        endDate: data.endDate,
        pickLockTime: data.pickLockTime,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function updatePhase(
  phaseId: string,
  data: Partial<Omit<NewPhase, "id" | "createdAt" | "updatedAt">>,
  tx?: Transaction,
): Promise<Phase> {
  const client = tx ?? db;
  const [result] = await client
    .update(phases)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(phases.id, phaseId))
    .returning();
  if (!result) {
    throw new NotFoundError("Phase not found");
  }
  return result;
}

export async function getPhasesBySeason(
  seasonId: string,
  tx?: Transaction,
): Promise<Phase[]> {
  const client = tx ?? db;
  return client
    .select()
    .from(phases)
    .where(eq(phases.seasonId, seasonId))
    .orderBy(asc(phases.startDate));
}

export async function getActivePhasesForSportsLeague(
  sportsLeagueId: string,
  now: Date,
  tx?: Transaction,
): Promise<Phase[]> {
  const client = tx ?? db;
  const rows = await client
    .select()
    .from(phases)
    .innerJoin(seasons, eq(phases.seasonId, seasons.id))
    .where(
      and(
        eq(seasons.sportsLeagueId, sportsLeagueId),
        lte(phases.startDate, now),
        gt(phases.endDate, now),
      ),
    );
  return rows.map((row) => row.phases);
}

export async function setLockedPhase(
  phaseId: string,
  lockedAt: Date,
  tx?: Transaction,
): Promise<Phase> {
  const client = tx ?? db;
  const [result] = await client
    .update(phases)
    .set({ lockedAt, updatedAt: new Date() })
    .where(eq(phases.id, phaseId))
    .returning();
  if (!result) {
    throw new NotFoundError("Phase not found");
  }
  return result;
}

export async function clearLockedPhase(
  phaseId: string,
  tx?: Transaction,
): Promise<Phase> {
  const client = tx ?? db;
  const [result] = await client
    .update(phases)
    .set({ lockedAt: null, updatedAt: new Date() })
    .where(eq(phases.id, phaseId))
    .returning();
  if (!result) {
    throw new NotFoundError("Phase not found");
  }
  return result;
}
