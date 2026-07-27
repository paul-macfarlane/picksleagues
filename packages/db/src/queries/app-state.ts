import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { APP_STATE_SINGLETON_ID, appState } from "../schema/app-state";

/**
 * The simulator's persisted state, read on every request to resolve the clock
 * and the provider. A missing row means the simulator has never been touched:
 * offset 0, no scenario — which is also exactly production's behaviour.
 */
export type SimState = {
  offsetMs: number;
  activeScenarioId: string | null;
};

const DEFAULT_SIM_STATE: SimState = { offsetMs: 0, activeScenarioId: null };

export async function getSimState(db: Db): Promise<SimState> {
  const rows = await db
    .select({
      offsetMs: appState.simClockOffsetMs,
      activeScenarioId: appState.simActiveScenarioId,
    })
    .from(appState)
    .where(eq(appState.id, APP_STATE_SINGLETON_ID));
  return rows[0] ?? DEFAULT_SIM_STATE;
}

/** Missing row means no scenario has ever touched the clock — offset 0. */
export async function getSimClockOffsetMs(db: Db): Promise<number> {
  const { offsetMs } = await getSimState(db);
  return offsetMs;
}

export async function setSimClockOffsetMs(db: Db, offsetMs: number): Promise<void> {
  await db
    .insert(appState)
    .values({ id: APP_STATE_SINGLETON_ID, simClockOffsetMs: offsetMs })
    .onConflictDoUpdate({ target: appState.id, set: { simClockOffsetMs: offsetMs } });
}

/**
 * Writes both simulator fields at once. Loading a scenario and resetting the
 * environment each change the active scenario *and* the clock together; issuing
 * them as two statements can leave a scenario active against the previous
 * offset, which for a replay means every game is already final.
 */
export async function setSimState(db: Db, state: SimState): Promise<void> {
  await db
    .insert(appState)
    .values({
      id: APP_STATE_SINGLETON_ID,
      simClockOffsetMs: state.offsetMs,
      simActiveScenarioId: state.activeScenarioId,
    })
    .onConflictDoUpdate({
      target: appState.id,
      set: {
        simClockOffsetMs: state.offsetMs,
        simActiveScenarioId: state.activeScenarioId,
      },
    });
}
