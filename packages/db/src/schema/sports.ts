import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { GameStatus, Sport, WeekType } from "@picksleagues/schemas";
import { users } from "./auth";

/**
 * Sports data ingested from the provider (ESPN in prod, SimulatedProvider in
 * non-prod) — request paths never call the provider directly; jobs sync these
 * tables and reads/settlement serve only from here (arch: Request paths never
 * call ESPN). `games` carries parallel `override_*` columns for manual admin
 * corrections (arch D15): ingestion writes only the provider-synced fields
 * below; every read/settlement site resolves `override_* ?? provider_*`, so a
 * re-sync can never clobber a correction. All timestamps are supplied by app
 * code from the injected Clock (arch D13) — no `.defaultNow()`.
 */

export const sportSeasons = pgTable(
  "sport_seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sport: text("sport").$type<Sport>().notNull(),
    // Year the season starts (e.g. 2025 = the season starting fall 2025).
    year: integer("year").notNull(),
    // True for a season row the schedule sync fabricated ahead of real
    // ingestion (ADR-0009 "upcoming seasons exist before their data") —
    // estimated dates/weeks pending the provider publishing the real
    // structure. Cleared in place (never re-forked) the day real ingestion
    // lands; never set on a season with any games.
    provisional: boolean("provisional").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique("sport_seasons_sport_year_unique").on(table.sport, table.year)],
);

/**
 * Reference data (arch D15/ADR-0010): teams are upserted by the schedule sync
 * the same way seasons are — never forked per game row. Two-key design:
 * `providerTeamId` is the real identity once a team has synced, but rows can
 * exist before that (backfill from the old text columns) — `abbreviation` is
 * the pre-provider-id bootstrap key those rows are matched on (NFL
 * abbreviations are stable). Both are declared unique per sport; Postgres
 * treats NULLs as distinct, so the nullable `providerTeamId` unique index
 * never blocks multiple not-yet-synced rows.
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sport: text("sport").$type<Sport>().notNull(),
    providerTeamId: text("provider_team_id"),
    abbreviation: text("abbreviation").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("teams_sport_provider_team_id_unique").on(table.sport, table.providerTeamId),
    unique("teams_sport_abbreviation_unique").on(table.sport, table.abbreviation),
  ],
);

export const weeks = pgTable(
  "weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => sportSeasons.id, { onDelete: "cascade" }),
    weekType: text("week_type").$type<WeekType>().notNull(),
    // 1-based within its week type — regular and postseason each restart at 1,
    // so this is unique only alongside `weekType` (see the constraint below).
    weekNumber: integer("week_number").notNull(),
    // Provider display label ("Week 5", "Wild Card"). Stored so playoff weeks
    // never render as "Week 2" off the bare weekNumber — the provider's own
    // wording is the only correct label for a postseason round.
    label: text("label").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("weeks_season_type_number_unique").on(table.seasonId, table.weekType, table.weekNumber),
    index("weeks_season_id_idx").on(table.seasonId),
  ],
);

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weekId: uuid("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    // ESPN event id — globally unique at the provider.
    providerGameId: text("provider_game_id").notNull().unique(),
    // RESTRICT (arch ADR-0010): a team can't be deleted out from under a game
    // row; teams are reference data with no deletion path in the app anyway.
    homeTeamId: uuid("home_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    awayTeamId: uuid("away_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
    status: text("status").$type<GameStatus>().notNull(),
    // Null until the game is in progress or final.
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    // Override parallels (admin corrections only — never written by ingestion, arch D15).
    overrideHomeScore: integer("override_home_score"),
    overrideAwayScore: integer("override_away_score"),
    overrideStatus: text("override_status").$type<GameStatus>(),
    overrideKickoffAt: timestamp("override_kickoff_at", { withTimezone: true }),
    overrideSpread: doublePrecision("override_spread"),
    overriddenBy: text("overridden_by").references(() => users.id, { onDelete: "set null" }),
    overriddenAt: timestamp("overridden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("games_week_id_idx").on(table.weekId),
    // Serves the sync-scores fast no-op query: any game with kickoff_at <= now
    // and status in (scheduled, in_progress)?
    index("games_status_kickoff_idx").on(table.status, table.kickoffAt),
  ],
);

export const oddsSnapshots = pgTable(
  "odds_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    // Home-team-relative; negative = home favored. Half-points are exactly
    // representable in doubles, so no numeric/decimal column is needed.
    spread: doublePrecision("spread").notNull(),
    // Clock value bound at insert (arch D13) — not the row's write time.
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Serves "latest snapshot per game".
    index("odds_snapshots_game_captured_idx").on(table.gameId, table.capturedAt),
  ],
);
