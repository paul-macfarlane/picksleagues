import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
    status: text("status").$type<LeagueStatus>().notNull(),
    // Season anchor for the clock-derived join cutoff and pre/post-start
    // windows ("first week started / Round of 64 tipped" needs to know which
    // season's games). Restrict: a season with leagues can't be swept away.
    seasonId: uuid("season_id")
      .notNull()
      .references(() => sportSeasons.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Serves discovery: public + active leagues, pre-cutoff filtering and
    // name search happen on that narrowed set.
    index("leagues_visibility_status_idx").on(table.visibility, table.status),
  ],
);

export const leagueSettings = pgTable("league_settings", {
  // 1:1 with leagues — the league id is the row's identity.
  leagueId: uuid("league_id")
    .primaryKey()
    .references(() => leagues.id, { onDelete: "cascade" }),
  // Shape per `leagues.mode`, validated by that mode's Zod schema
  // (LEAGUE_SETTINGS_SCHEMAS) on every write — the DB stores, the schema gates.
  settings: jsonb("settings").$type<LeagueSettings>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

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
    // Null = no expiry / no use cap (spec §Invites — both are optional).
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    // Incremented by a guarded UPDATE inside the join transaction so the
    // max-use cap can't be raced past.
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
