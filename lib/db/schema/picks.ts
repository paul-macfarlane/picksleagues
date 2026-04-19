import {
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { leagues } from "./leagues";
import { events, phases, teams } from "./sports";

export const pickResultEnum = pgEnum("pick_result", ["win", "loss", "push"]);

export type PickResult = (typeof pickResultEnum.enumValues)[number];

export const picks = pgTable(
  "picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    phaseId: uuid("phase_id")
      .notNull()
      .references(() => phases.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    // Frozen spread for against-the-spread leagues. Null for straight-up
    // leagues. The spread used at submission time is the one that counts
    // for scoring, even if the line later moves (BUSINESS_SPEC §9.3).
    spreadAtLock: doublePrecision("spread_at_lock"),
    pickResult: pickResultEnum("pick_result"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("picks_league_user_event_uniq").on(
      table.leagueId,
      table.userId,
      table.eventId,
    ),
    index("picks_league_user_idx").on(table.leagueId, table.userId),
    index("picks_phase_id_idx").on(table.phaseId),
    index("picks_event_id_idx").on(table.eventId),
  ],
);

export type Pick = typeof picks.$inferSelect;
export type NewPick = typeof picks.$inferInsert;
