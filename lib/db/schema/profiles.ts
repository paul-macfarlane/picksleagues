import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const profileRoleEnum = pgEnum("profile_role", ["user", "admin"]);

export type ProfileRole = (typeof profileRoleEnum.enumValues)[number];

export const profile = pgTable("profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: profileRoleEnum("role").notNull().default("user"),
  setupComplete: boolean("setup_complete").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
