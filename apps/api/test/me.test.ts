import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, createDb, sessions, users } from "@picksleagues/db";
import { FixedClock, type Env } from "@picksleagues/core";
import type { MeResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { getTestDatabaseUrl } from "./setup/test-database-url";

// Matches packages/core's Env shape without going through loadEnv (which
// caches process-wide) — this test builds its own Auth instance directly.
const testEnv: Env = {
  APP_ENV: "local",
  DATABASE_URL: getTestDatabaseUrl(),
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-id",
  DISCORD_CLIENT_SECRET: "discord-secret",
  JOB_SECRET: "b".repeat(32),
  ADMIN_USER_IDS: [],
};

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

const db = createDb(getTestDatabaseUrl());
const auth = createAuth({ env: testEnv, db });
const app = createApp({ auth, db, clock: async () => new FixedClock(FIXED_NOW) });

function patchMe(cookie: string | undefined, username: string) {
  return app.request("/api/me", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ username }),
  });
}

describe("PATCH /api/me", () => {
  beforeEach(async () => {
    // FK order: sessions/accounts reference users.
    await db.delete(sessions);
    await db.delete(accounts);
    await db.delete(users);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("401s with no session cookie", async () => {
    const res = await patchMe(undefined, "paulm");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("claims a valid username: 200, lowercased in the response, updatedAt stamped from the clock", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);

    const res = await patchMe(cookie, "paulm");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: user.id,
      username: "paulm",
      displayName: "Test User",
      email: user.email,
      image: null,
    });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.username).toBe("paulm");
    expect(row?.updatedAt).toEqual(FIXED_NOW);
  });

  it("lowercases uppercase input", async () => {
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await patchMe(cookie, "PaulM");

    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.username).toBe("paulm");
  });

  it("409s when a second user claims the same name in different casing, leaving the first user's row untouched", async () => {
    const first = await createAuthenticatedUser(auth, { username: "paulm" });
    const second = await createAuthenticatedUser(auth);

    const res = await patchMe(second.cookie, "PaulM");

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "username_taken" });

    const [firstRow] = await db.select().from(users).where(eq(users.id, first.user.id));
    expect(firstRow?.username).toBe("paulm");
  });

  it.each([
    { label: "too short", username: "ab" },
    { label: "hyphen", username: "has-hyphen" },
  ])("400s on a malformed username ($label)", async ({ username }) => {
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await patchMe(cookie, username);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("message");
  });

  it("releases the old name immediately on rename, so another user can claim it", async () => {
    const owner = await createAuthenticatedUser(auth, { username: "oldname" });
    const claimant = await createAuthenticatedUser(auth);

    const renameRes = await patchMe(owner.cookie, "newname");
    expect(renameRes.status).toBe(200);

    const claimRes = await patchMe(claimant.cookie, "oldname");
    expect(claimRes.status).toBe(200);
    const claimBody = (await claimRes.json()) as MeResponse;
    expect(claimBody.username).toBe("oldname");
  });
});
