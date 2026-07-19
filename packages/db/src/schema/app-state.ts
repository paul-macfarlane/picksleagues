import { bigint, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Singleton row (id = "singleton"). Holds the non-prod simulated-clock offset
 * (arch D13): serverless instances read it so they all agree on simulated time.
 * Production never reads it — resolveClock short-circuits to system time.
 */
export const appState = pgTable("app_state", {
  id: text("id").primaryKey(),
  simClockOffsetMs: bigint("sim_clock_offset_ms", { mode: "number" }).notNull().default(0),
});

export const APP_STATE_SINGLETON_ID = "singleton";
