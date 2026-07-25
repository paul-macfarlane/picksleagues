import type { Env } from "@picksleagues/core";
import { getTestDatabaseUrl } from "./test-database-url";

/**
 * Matches packages/core's `Env` shape without going through `loadEnv` (which
 * caches process-wide) — shared by any integration test that builds its own
 * `Auth`/`createApp` instance directly. Returns a fresh object per call so no
 * test file can mutate a shared instance out from under another. `overrides`
 * lets a test narrow one field (e.g. `ADMIN_USER_IDS`) without restating the
 * rest.
 */
export function makeTestEnv(overrides?: Partial<Env>): Env {
  return {
    APP_ENV: "local",
    // Test default only (production code defaults to false): most integration
    // tests exercise sim routes, so opting in per test would be noise.
    SIM_ENABLED: true,
    DATABASE_URL: getTestDatabaseUrl(),
    BETTER_AUTH_SECRET: "a".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    DISCORD_CLIENT_ID: "discord-id",
    DISCORD_CLIENT_SECRET: "discord-secret",
    JOB_SECRET: "b".repeat(32),
    ADMIN_USER_IDS: [],
    ...overrides,
  };
}
