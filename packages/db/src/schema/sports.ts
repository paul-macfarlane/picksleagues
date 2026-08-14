import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  NflGameStatContextOverridePayload,
  NflGameStatContextPayload,
  GameStatus,
  Sport,
  WeekType,
} from "@picksleagues/schemas";
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
 * abbreviations are stable), and that bootstrap uniqueness is scoped to rows
 * WITHOUT a provider id (partial index below). Once a row is provider-linked,
 * provider identity is the only key, and scoping the abbreviation unique to
 * bootstrap rows is what stops it rejecting provider data that legitimately
 * repeats an abbreviation. ESPN's placeholder "TBD" playoff teams were the case
 * that found this; they no longer reach the database at all (ADR-0021 excludes
 * unseeded rounds at the adapter), and the partial scope stays because it is
 * what makes the bootstrap key coherent in general. `providerTeamId` is
 * declared unique per sport; Postgres treats NULLs as distinct, so that
 * nullable unique index never blocks multiple not-yet-synced rows.
 * `location`/`logo*Url` are filled in by the same schedule sync from ESPN's
 * separate teams-listing endpoint (a provider team not yet in that listing
 * simply keeps these null until a later run finds it there).
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sport: text("sport").$type<Sport>().notNull(),
    providerTeamId: text("provider_team_id"),
    abbreviation: text("abbreviation").notNull(),
    name: text("name").notNull(),
    // City/market (ESPN's `location`) — nullable: bootstrap rows have no
    // provider metadata until the teams-listing enrichment step links them.
    location: text("location"),
    logoLightUrl: text("logo_light_url"),
    logoDarkUrl: text("logo_dark_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("teams_sport_provider_team_id_unique").on(table.sport, table.providerTeamId),
    uniqueIndex("teams_sport_abbreviation_bootstrap_unique")
      .on(table.sport, table.abbreviation)
      .where(sql`${table.providerTeamId} is null`),
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
    // The current line, home-team-relative; negative = home favored. Half-points
    // are exactly representable in doubles, so no numeric/decimal column is
    // needed. Nullable: a game legitimately has no line yet. Only the current
    // number is kept — the odds sync overwrites it (ADR-0018); the audit that
    // matters is `pickem_picks.spread_at_pick`, what the member accepted.
    spread: doublePrecision("spread"),
    // The book `spread` came from (PKM-9), written in the same `set()` as
    // `spread` in sync-odds so the two can never drift apart — free text, never
    // a const set, because ESPN has rotated the attributed book before. A
    // provider field like `spread` itself (never an `override_*`, arch D15):
    // ingestion writes it, and a read resolves it to null wherever
    // `override_spread` is set, since a commissioner's correction is not the
    // book's line.
    spreadSource: text("spread_source"),
    // Live in-game state (DATA-8): the 1-based period (5+ in overtime) and the
    // seconds remaining in it, normalized by the provider adapter — never its
    // display string. Both null unless the game is in progress, so they go back
    // to null when it ends. `updated_at` is their as-of instant: score sync only
    // writes the row when something it observes changed, so the last write is
    // the moment this clock reading was true (reads serve it as `stateAsOf`).
    period: integer("period"),
    clockSeconds: integer("clock_seconds"),
    // Override parallels (admin corrections only — never written by ingestion, arch D15).
    overrideHomeScore: integer("override_home_score"),
    overrideAwayScore: integer("override_away_score"),
    overrideStatus: text("override_status").$type<GameStatus>(),
    overrideKickoffAt: timestamp("override_kickoff_at", { withTimezone: true }),
    overrideSpread: doublePrecision("override_spread"),
    overridePeriod: integer("override_period"),
    overrideClockSeconds: integer("override_clock_seconds"),
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

/**
 * Per-team season record facts for the matchup stats surface (ADR-0040),
 * written by the stats sync from the provider's bulk standings. Provider facts
 * only: PPG/OPG averages and league ranks are derived at read from these rows,
 * never stored — a stored rank is wrong from the moment any other team's row
 * changes, the same staleness arch D11 rejects for lock flags. The `override_*`
 * parallels (ADR-0041, amending ADR-0040's original no-overrides decision)
 * follow the `games` pattern exactly: ingestion writes only provider columns,
 * reads resolve `override_* ?? provider_*`, and derivations (averages, ranks)
 * are computed from the resolved facts so a corrected record ranks as
 * corrected.
 *
 * `seasonYear` is a bare integer, deliberately not a `sport_seasons` FK: the
 * week-1 fallback serves *last* season's rows (ADR-0040), and a prior season's
 * stats legitimately exist without that season ever being synced here.
 */
export const nflTeamSeasonStats = pgTable(
  "nfl_team_season_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    seasonYear: integer("season_year").notNull(),
    wins: integer("wins").notNull(),
    losses: integer("losses").notNull(),
    ties: integer("ties").notNull(),
    homeWins: integer("home_wins").notNull(),
    homeLosses: integer("home_losses").notNull(),
    homeTies: integer("home_ties").notNull(),
    roadWins: integer("road_wins").notNull(),
    roadLosses: integer("road_losses").notNull(),
    roadTies: integer("road_ties").notNull(),
    // Signed count: +3 = won last three, -1 = lost last one, 0 = no games yet.
    streak: integer("streak").notNull(),
    pointsFor: integer("points_for").notNull(),
    pointsAgainst: integer("points_against").notNull(),
    // Override parallels (admin corrections only — never written by ingestion,
    // arch D15 / ADR-0041).
    overrideWins: integer("override_wins"),
    overrideLosses: integer("override_losses"),
    overrideTies: integer("override_ties"),
    overrideHomeWins: integer("override_home_wins"),
    overrideHomeLosses: integer("override_home_losses"),
    overrideHomeTies: integer("override_home_ties"),
    overrideRoadWins: integer("override_road_wins"),
    overrideRoadLosses: integer("override_road_losses"),
    overrideRoadTies: integer("override_road_ties"),
    overrideStreak: integer("override_streak"),
    overridePointsFor: integer("override_points_for"),
    overridePointsAgainst: integer("override_points_against"),
    overriddenBy: text("overridden_by").references(() => users.id, { onDelete: "set null" }),
    overriddenAt: timestamp("overridden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("nfl_team_season_stats_team_season_unique").on(table.teamId, table.seasonYear),
  ],
);

/**
 * Per-game matchup context (injuries, FPI, ATS, recent form — ADR-0040),
 * written by the stats sync from the provider's game summary. One JSONB
 * payload rather than discrete columns because this is an additively evolving
 * display snapshot (validated by `NflGameStatContextPayloadSchema`, parsed with
 * defaults at read — the league-settings pattern). `updated_at` is the as-of
 * instant the UI must show beside it: injuries move daily and this table
 * moves on the sync's schedule, so an unstamped report would read fresher
 * than it is (spec §UI conventions: never claim real-time freshness). It is
 * bumped by sync writes *and* override writes alike (ADR-0041, the `games`
 * precedent), so it dates the row as the member surface serves it — a
 * correction is a change to what the sheet shows, not a claim the provider
 * refreshed.
 *
 * `override_payload` is the JSONB analogue of column parallels (ADR-0041): a
 * *sparse* per-team payload whose present fields win over the provider's at
 * read (`override.field ?? provider.field`), so correcting one wrong injury
 * list doesn't freeze FPI/ATS/last-five at override-time values while the
 * sync keeps refreshing them. Ingestion never touches it.
 */
export const nflGameStatContext = pgTable("nfl_game_stat_context", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id")
    .notNull()
    .unique()
    .references(() => games.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<NflGameStatContextPayload>().notNull(),
  overridePayload: jsonb("override_payload").$type<NflGameStatContextOverridePayload>(),
  overriddenBy: text("overridden_by").references(() => users.id, { onDelete: "set null" }),
  overriddenAt: timestamp("overridden_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
