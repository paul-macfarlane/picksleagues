import { eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type {
  NewSimulatorState,
  SimulatorState,
} from "@/lib/db/schema/simulator";
import { simulatorState } from "@/lib/db/schema/simulator";

const SINGLETON = 1;

export async function getSimulatorState(
  tx?: Transaction,
): Promise<SimulatorState | null> {
  const client = tx ?? db;
  const result = await client.query.simulatorState.findFirst({
    where: eq(simulatorState.singleton, SINGLETON),
  });
  return result ?? null;
}

export async function upsertSimulatorState(
  data: Omit<NewSimulatorState, "id" | "singleton" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<SimulatorState> {
  const client = tx ?? db;
  const [result] = await client
    .insert(simulatorState)
    .values({ ...data, singleton: SINGLETON })
    .onConflictDoUpdate({
      target: simulatorState.singleton,
      set: {
        seasonYear: data.seasonYear,
        simNow: data.simNow,
        initialized: data.initialized,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function clearSimulatorState(tx?: Transaction): Promise<void> {
  const client = tx ?? db;
  await client
    .delete(simulatorState)
    .where(eq(simulatorState.singleton, SINGLETON));
}
