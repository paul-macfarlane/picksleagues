import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { APP_ROLE, type AppRole } from "@picksleagues/schemas";
import { citext } from "./column-types";

/**
 * Better Auth's core tables (user/session/account/verification), shaped for
 * the drizzle adapter per Better Auth's schema reference (confirmed via
 * `@better-auth/cli generate` against this repo's auth config) and renamed to
 * this repo's snake_case/plural table convention via `modelName` in
 * apps/api/src/auth.ts. Better Auth's own `createdAt`/`updatedAt` values are
 * always supplied explicitly by its internal adapter (never SQL now()), so
 * these timestamp columns carry no `.defaultNow()` (arch D13) — the adapter
 * writes every value it needs.
 *
 * `name` is remapped to `display_name` (mvp-spec §Users & Identity: OAuth-
 * prefilled, freely editable display name) via `user.fields.name` in the auth
 * config; the drizzle adapter looks up this table's fields by their *mapped*
 * name, so the JS property key here must literally be `display_name`.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  display_name: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // The member's own avatar URL (ADR-0022), overriding the provider's `image`
  // above by the repo's `override_* ?? provider_*` convention: every read
  // resolves `image_override ?? image`, so clearing this column reverts to
  // whatever the OAuth provider supplied rather than to no avatar. Better Auth
  // owns `image` and rewrites it on its own update-user route, which is
  // precisely why the member's value cannot live there.
  imageOverride: text("image_override"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  // Nullable until claimed at first sign-in (mvp-spec §Users & Identity);
  // citext gives case-insensitive uniqueness while preserving stored casing
  // (the app stores/displays lowercase per spec, enforced in packages/schemas).
  username: citext("username").unique(),
  // App-wide admin capability (ADR-0013), the sole authorization source for the
  // admin/sim surfaces — granted by a direct database update, never by config.
  // Better Auth never reads or writes this column (no `additionalFields`
  // entry), so plain `text` + `$type` like `league_members.role`, not a
  // Postgres enum.
  appRole: text("app_role").$type<AppRole>().notNull().default(APP_ROLE.USER),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);
