import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  dataSources,
  events,
  phases,
  seasons,
  sportsbooks,
  teams,
} from "./sports";

// --- Bridge Tables ---
// Pattern: (dataSourceId, externalId) -> internalId + metadata

export const externalSeasons = pgTable(
  "external_seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("external_seasons_source_ext_uniq").on(
      table.dataSourceId,
      table.externalId,
    ),
    index("external_seasons_season_id_idx").on(table.seasonId),
  ],
);

export type ExternalSeason = typeof externalSeasons.$inferSelect;
export type NewExternalSeason = typeof externalSeasons.$inferInsert;

export const externalPhases = pgTable(
  "external_phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    phaseId: uuid("phase_id")
      .notNull()
      .references(() => phases.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("external_phases_source_ext_uniq").on(
      table.dataSourceId,
      table.externalId,
    ),
    index("external_phases_phase_id_idx").on(table.phaseId),
  ],
);

export type ExternalPhase = typeof externalPhases.$inferSelect;
export type NewExternalPhase = typeof externalPhases.$inferInsert;

export const externalTeams = pgTable(
  "external_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("external_teams_source_ext_uniq").on(
      table.dataSourceId,
      table.externalId,
    ),
    index("external_teams_team_id_idx").on(table.teamId),
  ],
);

export type ExternalTeam = typeof externalTeams.$inferSelect;
export type NewExternalTeam = typeof externalTeams.$inferInsert;

export const externalEvents = pgTable(
  "external_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    oddsRef: text("odds_ref"),
    statusRef: text("status_ref"),
    homeScoreRef: text("home_score_ref"),
    awayScoreRef: text("away_score_ref"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("external_events_source_ext_uniq").on(
      table.dataSourceId,
      table.externalId,
    ),
    index("external_events_event_id_idx").on(table.eventId),
  ],
);

export type ExternalEvent = typeof externalEvents.$inferSelect;
export type NewExternalEvent = typeof externalEvents.$inferInsert;

export const externalSportsbooks = pgTable(
  "external_sportsbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    sportsbookId: uuid("sportsbook_id")
      .notNull()
      .references(() => sportsbooks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("external_sportsbooks_source_ext_uniq").on(
      table.dataSourceId,
      table.externalId,
    ),
    index("external_sportsbooks_sportsbook_id_idx").on(table.sportsbookId),
  ],
);

export type ExternalSportsbook = typeof externalSportsbooks.$inferSelect;
export type NewExternalSportsbook = typeof externalSportsbooks.$inferInsert;
