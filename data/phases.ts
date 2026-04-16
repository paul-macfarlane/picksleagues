import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { NewPhase, Phase } from "@/lib/db/schema/sports";
import { phases } from "@/lib/db/schema/sports";

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
