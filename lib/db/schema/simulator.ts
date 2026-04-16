import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Singleton state for the off-season test simulator.
// `singleton` is always 1 and unique, so at most one row exists.
export const simulatorState = pgTable("simulator_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  singleton: integer("singleton").notNull().unique().default(1),
  seasonYear: integer("season_year").notNull(),
  simNow: timestamp("sim_now").notNull(),
  initialized: boolean("initialized").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type SimulatorState = typeof simulatorState.$inferSelect;
export type NewSimulatorState = typeof simulatorState.$inferInsert;
