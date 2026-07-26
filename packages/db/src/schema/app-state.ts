import { bigint, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { simScenarios } from "./sim";

/**
 * Singleton row (id = "singleton"). Holds the non-prod simulator's state (arch
 * D13): serverless instances read it so they all agree on simulated time and on
 * which scenario is loaded. Production never reads either — resolveClock
 * short-circuits to system time, and provider resolution short-circuits to ESPN.
 */
export const appState = pgTable("app_state", {
  id: text("id").primaryKey(),
  simClockOffsetMs: bigint("sim_clock_offset_ms", { mode: "number" }).notNull().default(0),
  // Which scenario the SimulatedProvider serves, or null for real provider data —
  // the default in every environment (arch §Environments). SET NULL rather than
  // CASCADE: deleting a scenario deactivates the simulator, it doesn't delete the
  // singleton row that holds the clock offset.
  simActiveScenarioId: uuid("sim_active_scenario_id").references(() => simScenarios.id, {
    onDelete: "set null",
  }),
});

export const APP_STATE_SINGLETON_ID = "singleton";
