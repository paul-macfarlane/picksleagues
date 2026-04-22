import {
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// --- Enums ---

export const seasonTypeEnum = pgEnum("season_type", ["regular", "postseason"]);

export type SeasonType = (typeof seasonTypeEnum.enumValues)[number];

export const eventStatusEnum = pgEnum("event_status", [
  "not_started",
  "in_progress",
  "final",
]);

export type EventStatus = (typeof eventStatusEnum.enumValues)[number];

// --- Seed / Reference Tables ---

export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type DataSource = typeof dataSources.$inferSelect;
export type NewDataSource = typeof dataSources.$inferInsert;

export const sportsbooks = pgTable("sportsbooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type Sportsbook = typeof sportsbooks.$inferSelect;
export type NewSportsbook = typeof sportsbooks.$inferInsert;

export const sportsLeagues = pgTable("sports_leagues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  abbreviation: text("abbreviation").notNull().unique(),
  sport: text("sport").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type SportsLeague = typeof sportsLeagues.$inferSelect;
export type NewSportsLeague = typeof sportsLeagues.$inferInsert;

// --- Core Sports Tables ---

export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sportsLeagueId: uuid("sports_league_id")
      .notNull()
      .references(() => sportsLeagues.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("seasons_league_year_uniq").on(table.sportsLeagueId, table.year),
    index("seasons_sports_league_id_idx").on(table.sportsLeagueId),
  ],
);

export type Season = typeof seasons.$inferSelect;
export type NewSeason = typeof seasons.$inferInsert;

export const phases = pgTable(
  "phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    seasonType: seasonTypeEnum("season_type").notNull(),
    weekNumber: integer("week_number").notNull(),
    label: text("label").notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    pickLockTime: timestamp("pick_lock_time").notNull(),
    lockedAt: timestamp("locked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("phases_season_type_week_uniq").on(
      table.seasonId,
      table.seasonType,
      table.weekNumber,
    ),
    index("phases_season_id_idx").on(table.seasonId),
  ],
);

export type Phase = typeof phases.$inferSelect;
export type NewPhase = typeof phases.$inferInsert;

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sportsLeagueId: uuid("sports_league_id")
      .notNull()
      .references(() => sportsLeagues.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    location: text("location").notNull(),
    abbreviation: text("abbreviation").notNull(),
    logoUrl: text("logo_url"),
    logoDarkUrl: text("logo_dark_url"),
    lockedAt: timestamp("locked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("teams_sports_league_id_idx").on(table.sportsLeagueId)],
);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phaseId: uuid("phase_id")
      .notNull()
      .references(() => phases.id, { onDelete: "cascade" }),
    homeTeamId: uuid("home_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    awayTeamId: uuid("away_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    startTime: timestamp("start_time").notNull(),
    status: eventStatusEnum("status").notNull().default("not_started"),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    period: smallint("period"),
    clock: text("clock"),
    lockedAt: timestamp("locked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("events_phase_id_idx").on(table.phaseId),
    index("events_home_team_id_idx").on(table.homeTeamId),
    index("events_away_team_id_idx").on(table.awayTeamId),
  ],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export const odds = pgTable(
  "odds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    sportsbookId: uuid("sportsbook_id")
      .notNull()
      .references(() => sportsbooks.id, { onDelete: "restrict" }),
    homeSpread: doublePrecision("home_spread"),
    awaySpread: doublePrecision("away_spread"),
    homeMoneyline: integer("home_moneyline"),
    awayMoneyline: integer("away_moneyline"),
    overUnder: doublePrecision("over_under"),
    lockedAt: timestamp("locked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("odds_event_sportsbook_uniq").on(table.eventId, table.sportsbookId),
    index("odds_event_id_idx").on(table.eventId),
  ],
);

export type Odds = typeof odds.$inferSelect;
export type NewOdds = typeof odds.$inferInsert;
