import { z } from "@hono/zod-openapi";

/**
 * `users.app_role` is the sole source of app-wide admin capability (ADR-0013).
 * It lives in the database rather than the `ADMIN_USER_IDS` env allowlist
 * because capability must be grantable at runtime: the e2e suite mints users
 * with random ids *after* the API process has already read its env, so an
 * env-cached allowlist can never cover them. `ADMIN_USER_IDS` survives only as
 * a bootstrap seed that promotes to this role on sign-in.
 */
export const APP_ROLE = {
  USER: "user",
  ADMIN: "admin",
} as const;

export type AppRole = (typeof APP_ROLE)[keyof typeof APP_ROLE];

export const AppRoleSchema = z.enum(APP_ROLE).openapi("AppRole");
