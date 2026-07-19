import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { APP_STATE_SINGLETON_ID, appState } from "../schema/app-state.js";

/** Missing row means no scenario has ever touched the clock — offset 0. */
export async function getSimClockOffsetMs(db: Db): Promise<number> {
  const rows = await db
    .select({ offsetMs: appState.simClockOffsetMs })
    .from(appState)
    .where(eq(appState.id, APP_STATE_SINGLETON_ID));
  return rows[0]?.offsetMs ?? 0;
}

export async function setSimClockOffsetMs(db: Db, offsetMs: number): Promise<void> {
  await db
    .insert(appState)
    .values({ id: APP_STATE_SINGLETON_ID, simClockOffsetMs: offsetMs })
    .onConflictDoUpdate({ target: appState.id, set: { simClockOffsetMs: offsetMs } });
}
