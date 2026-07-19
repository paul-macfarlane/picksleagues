import { beforeEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "./env.js";

const validSource: Record<string, string | undefined> = {
  APP_ENV: "local",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5433/picksleagues",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:5173",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-id",
  DISCORD_CLIENT_SECRET: "discord-secret",
  JOB_SECRET: "b".repeat(32),
};

// loadEnv caches on first call — reset between cases so each exercises its own source.
beforeEach(() => {
  resetEnvCache();
});

describe("loadEnv", () => {
  it("accepts a valid source map", () => {
    const env = loadEnv(validSource);
    expect(env.APP_ENV).toBe("local");
    expect(env.DATABASE_URL).toBe("postgres://postgres:postgres@localhost:5433/picksleagues");
  });

  it("rejects a missing DATABASE_URL, listing the var name in the error", () => {
    const missingDatabaseUrl = { ...validSource, DATABASE_URL: undefined };
    expect(() => loadEnv(missingDatabaseUrl)).toThrowError(/DATABASE_URL/);
  });

  it.each([
    { raw: "a, b", expected: ["a", "b"] },
    { raw: "", expected: [] },
  ])("parses ADMIN_USER_IDS $raw", ({ raw, expected }) => {
    const env = loadEnv({ ...validSource, ADMIN_USER_IDS: raw });
    expect(env.ADMIN_USER_IDS).toEqual(expected);
  });
});
