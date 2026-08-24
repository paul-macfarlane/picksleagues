import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, createDb, sessions, setSimState, users } from "@picksleagues/db";
import { FixedClock, type Env } from "@picksleagues/core";
import { APP_ROLE, DELETED_USER_DISPLAY_NAME, type MeResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";
import { withCookie } from "./setup/fixed-app";

const testEnv = makeTestEnv();

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

// `.invalid` hosts (RFC 2606) throughout: nothing here should be resolvable,
// let alone fetchable — the app validates the URL's shape and never retrieves it.
const PROVIDER_IMAGE = "https://provider.example.invalid/from-oauth.png";
const MEMBER_IMAGE = "https://cdn.example.invalid/member-set.png";

const db = createDb(getTestDatabaseUrl());
const auth = createAuth({ env: testEnv, db });
const app = createApp({ auth, db, clock: async () => new FixedClock(FIXED_NOW) });

function getMe(cookie: string | undefined) {
  return app.request("/api/me", {
    method: "GET",
    headers: {
      ...withCookie(cookie),
    },
  });
}

function patchMeBody(cookie: string | undefined, body: Record<string, unknown>) {
  return app.request("/api/me", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...withCookie(cookie),
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
      ...withCookie(cookie),
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
  await resetDb(db);
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
      imageOverride: null,
      providerImage: null,
      isAdmin: false,
      simEnabled: false,
      simClockOffsetMs: 0,
      // Served from the injected Clock (arch D13), never a raw `new Date()` —
      // pinned to the fixture instant so a regression to real time fails here.
      now: FIXED_NOW.toISOString(),
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

  it("200s with isAdmin true when the user holds the admin role", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);

    const res = await getMe(cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.isAdmin).toBe(true);
  });

  // The SPA hides sim surfaces off this flag; the real gate is that /api/sim/*
  // is never registered where the simulator is disabled (ADR-0011), and
  // production is disabled regardless of SIM_ENABLED (ADR-0014).
  it.each([
    { appEnv: "local", simEnabled: true, expected: true },
    { appEnv: "local", simEnabled: false, expected: false },
    { appEnv: "staging", simEnabled: true, expected: true },
    { appEnv: "production", simEnabled: false, expected: false },
    { appEnv: "production", simEnabled: true, expected: false },
  ])(
    "reports simEnabled $expected when APP_ENV is $appEnv and SIM_ENABLED is $simEnabled",
    async ({ appEnv, simEnabled, expected }) => {
      const { cookie } = await createAuthenticatedUser(auth);
      const envApp = createApp({
        auth,
        db,
        env: makeTestEnv({ APP_ENV: appEnv as Env["APP_ENV"], SIM_ENABLED: simEnabled }),
        clock: async () => new FixedClock(FIXED_NOW),
      });

      const res = await envApp.request("/api/me", { method: "GET", headers: { cookie } });

      expect(res.status).toBe(200);
      const body = (await res.json()) as MeResponse;
      expect(body.simEnabled).toBe(expected);
    },
  );

  // FB-38: what lets a non-admin's shell say "now isn't real" without touching
  // the admin-only sim state route.
  it("reports the simulated clock offset where the simulator is on, and 0 where it isn't", async () => {
    const { cookie } = await createAuthenticatedUser(auth);
    await setSimState(db, { activeScenarioId: null, offsetMs: 90 * 60 * 1000 });

    const simApp = createApp({
      auth,
      db,
      env: makeTestEnv({ APP_ENV: "staging", SIM_ENABLED: true }),
      clock: async () => new FixedClock(FIXED_NOW),
    });
    const simBody = (await (
      await simApp.request("/api/me", { method: "GET", headers: { cookie } })
    ).json()) as MeResponse;
    expect(simBody.simClockOffsetMs).toBe(90 * 60 * 1000);

    // Same stored offset, simulator off: the row is never read, so the SPA is
    // told the clock is real — which it is, since the clock resolution short-
    // circuits the same way (arch D13).
    const realBody = (await (await getMe(cookie)).json()) as MeResponse;
    expect(realBody.simClockOffsetMs).toBe(0);
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
      imageOverride: null,
      providerImage: null,
      isAdmin: false,
      simEnabled: false,
      simClockOffsetMs: 0,
      // Served from the injected Clock (arch D13), never a raw `new Date()` —
      // pinned to the fixture instant so a regression to real time fails here.
      now: FIXED_NOW.toISOString(),
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
      imageOverride: null,
      providerImage: null,
      isAdmin: false,
      simEnabled: false,
      simClockOffsetMs: 0,
      // Served from the injected Clock (arch D13), never a raw `new Date()` —
      // pinned to the fixture instant so a regression to real time fails here.
      now: FIXED_NOW.toISOString(),
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
      imageOverride: null,
      providerImage: null,
      isAdmin: false,
      simEnabled: false,
      simClockOffsetMs: 0,
      // Served from the injected Clock (arch D13), never a raw `new Date()` —
      // pinned to the fixture instant so a regression to real time fails here.
      now: FIXED_NOW.toISOString(),
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

  it("sets the avatar override and serves it as the resolved image", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);

    const res = await patchMeBody(cookie, { imageOverride: MEMBER_IMAGE });

    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.image).toBe(MEMBER_IMAGE);
    expect(body.imageOverride).toBe(MEMBER_IMAGE);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.imageOverride).toBe(MEMBER_IMAGE);
  });

  /**
   * The whole point of the two-column split (ADR-0022): the provider's avatar
   * has to still be there to fall back to, so clearing can revert to it. A
   * single column would have been overwritten on the way in and the fallback
   * would be gone for good.
   */
  it("falls back to the provider image when unset, and clearing the override reverts to it", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    // Straight to the column Better Auth owns — no app route writes it.
    await db.update(users).set({ image: PROVIDER_IMAGE }).where(eq(users.id, user.id));

    const beforeBody = (await (await getMe(cookie)).json()) as MeResponse;
    expect(beforeBody.image).toBe(PROVIDER_IMAGE);
    expect(beforeBody.imageOverride).toBeNull();

    const setBody = (await (
      await patchMeBody(cookie, { imageOverride: MEMBER_IMAGE })
    ).json()) as MeResponse;
    expect(setBody.image).toBe(MEMBER_IMAGE);
    // Still exposed while the override is set — this is what lets the profile
    // editor preview what clearing would revert to (ADR-0022).
    expect(setBody.providerImage).toBe(PROVIDER_IMAGE);

    const clearRes = await patchMeBody(cookie, { imageOverride: null });
    expect(clearRes.status).toBe(200);
    const clearedBody = (await clearRes.json()) as MeResponse;
    expect(clearedBody.image).toBe(PROVIDER_IMAGE);
    expect(clearedBody.imageOverride).toBeNull();

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.imageOverride).toBeNull();
    expect(row?.image).toBe(PROVIDER_IMAGE);
  });

  it.each([
    { label: "http, not https", imageOverride: "http://cdn.example.invalid/a.png" },
    { label: "javascript: scheme", imageOverride: "javascript:alert(1)" },
    { label: "data: URL", imageOverride: "data:image/png;base64,iVBORw0KGgo=" },
    { label: "protocol-relative", imageOverride: "//cdn.example.invalid/a.png" },
    { label: "not a URL at all", imageOverride: "not a url" },
    {
      label: "over 2048 chars",
      imageOverride: `https://cdn.example.invalid/${"a".repeat(2049 - 28)}`,
    },
  ])("400s on a refused avatar URL ($label)", async ({ imageOverride }) => {
    const { user, cookie } = await createAuthenticatedUser(auth);

    const res = await patchMeBody(cookie, { imageOverride });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("message");

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.imageOverride).toBeNull();
  });

  it("leaves an existing override alone when the field is omitted", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await patchMeBody(cookie, { imageOverride: MEMBER_IMAGE });

    const res = await patchMeBody(cookie, { displayName: "New Name" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.imageOverride).toBe(MEMBER_IMAGE);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.imageOverride).toBe(MEMBER_IMAGE);
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

describe("Better Auth's /api/auth/update-user cannot reach the app's validated columns", () => {
  // Omitting `app_role` from `user.fields`/`additionalFields` (apps/api/src/
  // auth.ts) is the only thing keeping Better Auth's own update-user route
  // from granting admin. This guards that claim against a future edit adding
  // an `additionalFields` entry for any of the plausible key spellings.
  it("drops app_role/appRole/role write attempts while the legitimate field still applies", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);

    const res = await app.request("/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "New Name",
        app_role: APP_ROLE.ADMIN,
        appRole: APP_ROLE.ADMIN,
        role: APP_ROLE.ADMIN,
      }),
    });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.display_name).toBe("New Name");
    expect(row?.appRole).toBe(APP_ROLE.USER);
  });

  // Better Auth's update-user body is `z.record(z.string(), z.any())`, so an
  // `additionalFields` entry for the override would hand it a write path that
  // never sees `ImageUrlSchema` — which is the reason the member's avatar lives
  // in its own column rather than in `image` (ADR-0022).
  it("drops image_override/imageOverride/avatarUrl write attempts", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);

    const res = await app.request("/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "New Name",
        image_override: MEMBER_IMAGE,
        imageOverride: MEMBER_IMAGE,
        avatarUrl: MEMBER_IMAGE,
      }),
    });

    expect(res.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.display_name).toBe("New Name");
    expect(row?.imageOverride).toBeNull();
    // Nothing is asserted about `users.image`: that route legitimately writes
    // the provider column, and pinning it here would freeze a decision the
    // ADR deliberately left open.
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
      imageOverride: null,
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

  it("clears app_role to user, so a deleted admin's tombstone row holds no capability", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);

    const res = await deleteMe(cookie);
    expect(res.status).toBe(204);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.appRole).toBe(APP_ROLE.USER);
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
