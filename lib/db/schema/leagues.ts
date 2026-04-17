import {
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { seasons, sportsLeagues } from "./sports";

// --- Enums ---

export const seasonFormatEnum = pgEnum("season_format", [
  "regular_season",
  "postseason",
  "full_season",
]);

export type SeasonFormat = (typeof seasonFormatEnum.enumValues)[number];

export const pickTypeEnum = pgEnum("pick_type", [
  "straight_up",
  "against_the_spread",
]);

export type PickType = (typeof pickTypeEnum.enumValues)[number];

export const leagueRoleEnum = pgEnum("league_role", ["commissioner", "member"]);

export type LeagueRole = (typeof leagueRoleEnum.enumValues)[number];

// --- Tables ---

export const leagues = pgTable(
  "leagues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sportsLeagueId: uuid("sports_league_id")
      .notNull()
      .references(() => sportsLeagues.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    seasonFormat: seasonFormatEnum("season_format").notNull(),
    size: integer("size").notNull(),
    picksPerPhase: integer("picks_per_phase").notNull(),
    pickType: pickTypeEnum("pick_type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("leagues_sports_league_id_idx").on(table.sportsLeagueId)],
);

export type League = typeof leagues.$inferSelect;
export type NewLeague = typeof leagues.$inferInsert;

export const leagueMembers = pgTable(
  "league_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: leagueRoleEnum("role").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("league_members_league_user_uniq").on(table.leagueId, table.userId),
    index("league_members_user_id_idx").on(table.userId),
    index("league_members_league_id_idx").on(table.leagueId),
  ],
);

export type LeagueMember = typeof leagueMembers.$inferSelect;
export type NewLeagueMember = typeof leagueMembers.$inferInsert;

export const leagueStandings = pgTable(
  "league_standings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "restrict" }),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    pushes: integer("pushes").notNull().default(0),
    points: doublePrecision("points").notNull().default(0),
    rank: integer("rank").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("league_standings_league_user_season_uniq").on(
      table.leagueId,
      table.userId,
      table.seasonId,
    ),
    index("league_standings_league_season_idx").on(
      table.leagueId,
      table.seasonId,
    ),
  ],
);

export type LeagueStanding = typeof leagueStandings.$inferSelect;
export type NewLeagueStanding = typeof leagueStandings.$inferInsert;

export const directInvites = pgTable(
  "direct_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    inviteeUserId: text("invitee_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    inviterUserId: text("inviter_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    role: leagueRoleEnum("role").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("direct_invites_league_invitee_uniq").on(
      table.leagueId,
      table.inviteeUserId,
    ),
    index("direct_invites_invitee_user_id_idx").on(table.inviteeUserId),
    index("direct_invites_league_id_idx").on(table.leagueId),
  ],
);

export type DirectInvite = typeof directInvites.$inferSelect;
export type NewDirectInvite = typeof directInvites.$inferInsert;

export const linkInvites = pgTable(
  "link_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    inviterUserId: text("inviter_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    role: leagueRoleEnum("role").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("link_invites_league_id_idx").on(table.leagueId)],
);

export type LinkInvite = typeof linkInvites.$inferSelect;
export type NewLinkInvite = typeof linkInvites.$inferInsert;
