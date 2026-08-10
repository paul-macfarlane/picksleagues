import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  LeagueMode,
  LeagueSettings,
  LeagueStatus,
  LeagueVisibility,
  MemberRole,
} from "@picksleagues/schemas";
import { users } from "./auth";
import { sportSeasons } from "./sports";

/**
 * League lifecycle, membership, and invites — the mode-agnostic core (spec
 * §Leagues). Commissionership lives only in `league_members.role`; there is
 * deliberately no `commissioner_id` on `leagues` (ADR-0004), and the
 * ≥1-commissioner invariant plus the 10-active-commissioner cap are enforced
 * by counted queries inside service transactions, not by DB constraints.
 * Pre/post-start is never stored — it derives from game timestamps + the
 * injected Clock at query time (arch §Locking Model, D11). All timestamps are
 * supplied by app code from the Clock (arch D13) — no `.defaultNow()`.
 */

export const leagues = pgTable(
  "leagues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    mode: text("mode").$type<LeagueMode>().notNull(),
    visibility: text("visibility").$type<LeagueVisibility>().notNull(),
    // Commissioner-configurable cap, never above the global MAX_LEAGUE_SIZE
    // ceiling (packages/schemas) — the join transaction reads this column
    // instead of the global constant so a league can shrink its own room.
    maxMembers: integer("max_members").notNull().default(10),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Serves discovery's visibility filter; the active-status and pre-cutoff
    // narrowing joins `league_seasons` (status is now per-season, ADR-0009).
    index("leagues_visibility_idx").on(table.visibility),
    // 2 and 100 are intentionally duplicated from MAX_LEAGUE_SIZE
    // (packages/schemas) — SQL DDL can't import a TS constant. If that
    // constant changes, this literal must move with it via a new migration.
    check("leagues_max_members_range", sql`${table.maxMembers} between 2 and 100`),
  ],
);

/**
 * Per-season instance of a league (ADR-0009): a league keeps identity only, and
 * everything that is per-year — the settings JSONB (absorbing the old
 * `league_settings` table), the status, and the clock-derived start boundary's
 * season anchor — lives here. A league's *current* season is its instance with
 * the greatest `sport_seasons.year` (derived at read time, no pointer column).
 * Renewal (SF-3) mints the next instance with settings copied. Existing leagues
 * backfilled to exactly one instance.
 */
export const leagueSeasons = pgTable(
  "league_seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    // Season anchor for the clock-derived join cutoff and pre/post-start
    // windows ("first week started / Round of 64 tipped" needs to know which
    // season's games). Restrict: a season with leagues can't be swept away.
    seasonId: uuid("season_id")
      .notNull()
      .references(() => sportSeasons.id, { onDelete: "restrict" }),
    // Shape per the league's mode, validated by that mode's Zod schema
    // (LEAGUE_SETTINGS_SCHEMAS) on every write — the DB stores, the schema gates.
    settings: jsonb("settings").$type<LeagueSettings>().notNull(),
    status: text("status").$type<LeagueStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // One instance per league per season (ADR-0009) — the DB encodes it so
    // renewal can't double-mint the same season.
    unique("league_seasons_league_season_unique").on(table.leagueId, table.seasonId),
    // Serves the current-instance lookup (join a league to its seasons).
    index("league_seasons_league_id_idx").on(table.leagueId),
  ],
);

export const leagueMembers = pgTable(
  "league_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    // Restrict: users are anonymized in place, never deleted (ID-3), and
    // membership history must survive — a cascade here could silently erase
    // picks/standings lineage if that ever changed.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role").$type<MemberRole>().notNull(),
    // createdAt is the join timestamp (arch §Domain Model `joined_at`).
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // One membership per user per league (spec §Membership) — the DB encodes
    // the rule; the join endpoint's 409 is derived from this constraint.
    unique("league_members_league_user_unique").on(table.leagueId, table.userId),
    // Serves the dashboard "my leagues" lookup and the commissioner-cap count.
    index("league_members_user_id_idx").on(table.userId),
  ],
);

export const leagueInvites = pgTable(
  "league_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    // Opaque code carried in /join/:code links (arch §Invites).
    code: text("code").notNull().unique(),
    // Set null: the invite outlives its creator's account deletion.
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    // Informational only since ADR-0032 (expiry and max-use caps were cut):
    // still incremented inside the join transaction, but nothing enforces on
    // it — it feeds the commissioner panel's "Uses" readout.
    useCount: integer("use_count").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Serves the commissioner invite-management list.
    index("league_invites_league_id_idx").on(table.leagueId),
  ],
);
