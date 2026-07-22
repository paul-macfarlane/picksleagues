import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, createDb, sessions, users } from "@picksleagues/db";
import { FixedClock, type Env } from "@picksleagues/core";
import { DELETED_USER_DISPLAY_NAME, type MeResponse } from "@picksleagues/schemas";
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

function getMe(cookie: string | undefined) {
  return app.request("/api/me", {
    method: "GET",
    headers: {
      ...(cookie ? { cookie } : {}),
    },
  });
}

function patchMeBody(cookie: string | undefined, body: Record<string, unknown>) {
  return app.request("/api/me", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function patchMe(cookie: string | undefined, username: string) {
  return patchMeBody(cookie, { username });
}

function deleteMe(cookie: string | undefined) {
  return app.request("/api/me", {
    method: "DELETE",
    headers: {
      ...(cookie ? { cookie } : {}),
    },
  });
}

/**
 * `createAuthenticatedUser` goes through Better Auth's internal adapter's
 * `createUser`, which only inserts the `users` row — it never links an
 * `accounts` row the way a real OAuth sign-in would. Tests that need to
 * exercise account-row deletion insert one directly.
 */
async function insertAccount(userId: string) {
  await db.insert(accounts).values({
    id: randomUUID(),
    accountId: randomUUID(),
    providerId: "google",
    userId,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
}

beforeEach(async () => {
  // FK order: sessions/accounts reference users.
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);
});

afterAll(async () => {
  await db.$client.end();
});

describe("GET /api/me", () => {
  it("401s with no session cookie", async () => {
    const res = await getMe(undefined);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("200s with the full profile shape for a user who hasn't claimed a username yet", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);

    const res = await getMe(cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: user.id,
      username: null,
      displayName: "Test User",
      email: user.email,
      image: null,
    });
  });

  it("200s reflecting a claimed username", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    await patchMe(cookie, "paulm");

    const res = await getMe(cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.username).toBe("paulm");
  });
});

describe("PATCH /api/me", () => {
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

  it("updates only the display name, leaving username untouched, stamping updatedAt from the clock", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth, { username: "paulm" });

    const res = await patchMeBody(cookie, { displayName: "New Name" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: user.id,
      username: "paulm",
      displayName: "New Name",
      email: user.email,
      image: null,
    });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.username).toBe("paulm");
    expect(row?.display_name).toBe("New Name");
    expect(row?.updatedAt).toEqual(FIXED_NOW);
  });

  it("updates both username and display name together", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);

    const res = await patchMeBody(cookie, { username: "paulm", displayName: "New Name" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: user.id,
      username: "paulm",
      displayName: "New Name",
      email: user.email,
      image: null,
    });
  });

  it("400s when no fields are supplied", async () => {
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await patchMeBody(cookie, {});

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("message");
  });

  it("stores the display name trimmed", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);

    const res = await patchMeBody(cookie, { displayName: "  padded  " });

    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.displayName).toBe("padded");

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.display_name).toBe("padded");
  });
});

describe("DELETE /api/me", () => {
  it("401s with no session cookie", async () => {
    const res = await deleteMe(undefined);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("204s and anonymizes the profile, removes accounts/sessions, and signs the caller out everywhere", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth, { username: "paulm" });
    await insertAccount(user.id);

    const res = await deleteMe(cookie);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({
      username: null,
      display_name: DELETED_USER_DISPLAY_NAME,
      image: null,
      email: `deleted-${user.id}@deleted.invalid`,
      emailVerified: false,
    });
    expect(row?.updatedAt).toEqual(FIXED_NOW);

    const remainingAccounts = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(remainingAccounts).toHaveLength(0);
    const remainingSessions = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remainingSessions).toHaveLength(0);

    const followUp = await getMe(cookie);
    expect(followUp.status).toBe(401);
  });

  it("releases the deleted user's username immediately, so another user can claim it", async () => {
    const first = await createAuthenticatedUser(auth, { username: "recycled" });
    const second = await createAuthenticatedUser(auth);

    const deleteRes = await deleteMe(first.cookie);
    expect(deleteRes.status).toBe(204);

    const claimRes = await patchMe(second.cookie, "recycled");
    expect(claimRes.status).toBe(200);
    const claimBody = (await claimRes.json()) as MeResponse;
    expect(claimBody.username).toBe("recycled");
  });

  it("deletes two accounts without an email placeholder collision", async () => {
    const first = await createAuthenticatedUser(auth);
    const second = await createAuthenticatedUser(auth);

    expect((await deleteMe(first.cookie)).status).toBe(204);
    expect((await deleteMe(second.cookie)).status).toBe(204);

    const [firstRow] = await db.select().from(users).where(eq(users.id, first.user.id));
    const [secondRow] = await db.select().from(users).where(eq(users.id, second.user.id));
    expect(firstRow?.email).toBe(`deleted-${first.user.id}@deleted.invalid`);
    expect(secondRow?.email).toBe(`deleted-${second.user.id}@deleted.invalid`);
  });
});
