import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { SimFinalStatus, SimScenarioSource, Sport, WeekType } from "@picksleagues/schemas";

/**
 * Simulator fixture tables (SIM-1; arch §Simulator & Time, ADR-0011/ADR-0012).
 * Non-prod only in practice — the routes that write them are not registered when
 * `APP_ENV=production` — but the tables exist in every environment so migrations
 * stay identical across envs.
 *
 * These are the `SimulatedProvider`'s backing store, standing in for ESPN's API
 * rather than for our own synced tables: fixtures hold *provider-shaped* rows
 * (team abbreviations, a provider game id, a week type + number), and the normal
 * sync jobs ingest from the provider into `sport_seasons`/`weeks`/`games`/
 * `odds_snapshots` exactly as they do from ESPN. Nothing downstream of ingestion
 * knows the simulator exists.
 *
 * All timestamps are supplied by app code from the injected Clock (arch D13) —
 * no `.defaultNow()`.
 */

export const simScenarios = pgTable(
  "sim_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Stable operator-facing key: a library scenario's definition key ("push-ats")
    // or "replay-nfl-2024". Unique, so re-importing a season or reloading a
    // library scenario replaces its fixtures instead of accumulating duplicates.
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    sport: text("sport").$type<Sport>().notNull(),
    seasonYear: integer("season_year").notNull(),
    source: text("source").$type<SimScenarioSource>().notNull(),
    // Where the simulated clock is positioned when this scenario loads (ADR-0012).
    // Without it, replaying a past season would start with every game already
    // final, and a library scenario's relative kickoffs would be unreachable.
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sim_scenarios_sport_season_idx").on(table.sport, table.seasonYear)],
);

export const simFixtureWeeks = pgTable(
  "sim_fixture_weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => simScenarios.id, { onDelete: "cascade" }),
    weekType: text("week_type").$type<WeekType>().notNull(),
    // Domain numbering, matching `weeks.week_number` — regular 1..18, postseason
    // 1..4 with the Super Bowl at 4 (the provider contract's numbering, not ESPN's).
    weekNumber: integer("week_number").notNull(),
    label: text("label").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("sim_fixture_weeks_scenario_type_number_unique").on(
      table.scenarioId,
      table.weekType,
      table.weekNumber,
    ),
    index("sim_fixture_weeks_scenario_id_idx").on(table.scenarioId),
  ],
);

export const simFixtureGames = pgTable(
  "sim_fixture_games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => simScenarios.id, { onDelete: "cascade" }),
    // Synthetic stand-in for an ESPN event id, unique within the scenario. Also
    // the seed for synthesized spreads (SIM-6), so a re-import reproduces the
    // exact same spreads.
    providerGameId: text("provider_game_id").notNull(),
    // The game's week by (type, number) rather than a FK to sim_fixture_weeks: a
    // hand-edit moving a game to another week (the "week move" edge case) is then
    // a single column update, and a game can reference a week the scenario
    // deliberately hasn't declared.
    weekType: text("week_type").$type<WeekType>().notNull(),
    weekNumber: integer("week_number").notNull(),
    homeTeamAbbr: text("home_team_abbr").notNull(),
    homeTeamName: text("home_team_name").notNull(),
    homeTeamProviderId: text("home_team_provider_id").notNull(),
    awayTeamAbbr: text("away_team_abbr").notNull(),
    awayTeamName: text("away_team_name").notNull(),
    awayTeamProviderId: text("away_team_provider_id").notNull(),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
    // Home-team-relative, matching `odds_snapshots.spread` (negative = home
    // favored). Nullable: a fixture can deliberately have no spread, which is how
    // a straight-up-only week is expressed.
    spread: doublePrecision("spread"),
    // The fixture's terminal truth. The provider reports `scheduled`/`in_progress`
    // instead until the simulated clock passes the game (ADR-0012) — these
    // columns are what the game *ends* as, never what a caller sees today.
    finalStatus: text("final_status").$type<SimFinalStatus>().notNull(),
    finalHomeScore: integer("final_home_score"),
    finalAwayScore: integer("final_away_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("sim_fixture_games_scenario_provider_game_unique").on(
      table.scenarioId,
      table.providerGameId,
    ),
    index("sim_fixture_games_scenario_week_idx").on(
      table.scenarioId,
      table.weekType,
      table.weekNumber,
    ),
  ],
);

export const simFixtureTeams = pgTable(
  "sim_fixture_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => simScenarios.id, { onDelete: "cascade" }),
    providerTeamId: text("provider_team_id").notNull(),
    abbreviation: text("abbreviation").notNull(),
    name: text("name").notNull(),
    location: text("location").notNull(),
    logoLightUrl: text("logo_light_url"),
    logoDarkUrl: text("logo_dark_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("sim_fixture_teams_scenario_provider_team_unique").on(
      table.scenarioId,
      table.providerTeamId,
    ),
    index("sim_fixture_teams_scenario_id_idx").on(table.scenarioId),
  ],
);
