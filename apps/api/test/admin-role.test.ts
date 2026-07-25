import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, users } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import { APP_ROLE, type MeResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createAuthenticatedUser } from "./setup/auth-helpers";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

/**
 * App-wide admin capability lives in `users.app_role`, with `ADMIN_USER_IDS`
 * demoted to a bootstrap seed applied on session resolution (ADR-0013). These
 * tests pin both halves: the column is what authorizes, and the seed is what
 * grants it without manual SQL.
 */

const FIXED_NOW = new Date("2026-09-09T00:00:00.000Z");

const db = createDb(getTestDatabaseUrl());
// One `auth` shared by every app built below — cookies stay valid across them
// since they share `db` and makeTestEnv's `BETTER_AUTH_SECRET`.
const auth = createAuth({ env: makeTestEnv(), db });

function buildApp(seedUserIds: string[] = []) {
  return createApp({
    auth,
    db,
    env: makeTestEnv({ ADMIN_USER_IDS: seedUserIds }),
    clock: async () => new FixedClock(FIXED_NOW),
  });
}

function getMe(app: ReturnType<typeof buildApp>, cookie: string) {
  return app.request("/api/me", { headers: { cookie } });
}

/** An admin-only route with no seeded data requirements of its own. */
function getAdminTeams(app: ReturnType<typeof buildApp>, cookie: string) {
  return app.request("/api/admin/teams?sport=nfl", { headers: { cookie } });
}

async function readAppRole(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row?.appRole;
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("ADMIN_USER_IDS bootstrap seeding", () => {
  it("promotes a seeded user's app_role on their first authenticated request", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    expect(await readAppRole(user.id)).toBe("user");

    const res = await getMe(buildApp([user.id]), cookie);

    expect(res.status).toBe(200);
    expect(((await res.json()) as MeResponse).isAdmin).toBe(true);
    expect(await readAppRole(user.id)).toBe("admin");
  });

  it("is idempotent: repeat requests leave the caller admin", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    const app = buildApp([user.id]);

    expect((await getMe(app, cookie)).status).toBe(200);
    expect((await getMe(app, cookie)).status).toBe(200);

    expect(await readAppRole(user.id)).toBe("admin");
    expect((await getAdminTeams(app, cookie)).status).toBe(200);
  });

  it("never demotes: dropping the id from the seed list keeps the granted role", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    expect((await getMe(buildApp([user.id]), cookie)).status).toBe(200);

    const unseeded = buildApp();
    const res = await getMe(unseeded, cookie);

    expect(res.status).toBe(200);
    expect(((await res.json()) as MeResponse).isAdmin).toBe(true);
    expect(await readAppRole(user.id)).toBe("admin");
    expect((await getAdminTeams(unseeded, cookie)).status).toBe(200);
  });

  it("leaves a user who isn't seeded at the default role", async () => {
    const seeded = await createAuthenticatedUser(auth);
    const other = await createAuthenticatedUser(auth);
    const app = buildApp([seeded.user.id]);

    const res = await getMe(app, other.cookie);

    expect(res.status).toBe(200);
    expect(((await res.json()) as MeResponse).isAdmin).toBe(false);
    expect(await readAppRole(other.user.id)).toBe("user");

    const denied = await getAdminTeams(app, other.cookie);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "not_admin" });
  });
});

describe("users.app_role as the authorization source", () => {
  it("grants admin routes to a DB-promoted user with an empty seed list", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await db.update(users).set({ appRole: APP_ROLE.ADMIN }).where(eq(users.id, user.id));
    const app = buildApp();

    const res = await getAdminTeams(app, cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teams: [] });
  });

  it("reports isAdmin off the column, not the env, for a DB-promoted user", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await db.update(users).set({ appRole: APP_ROLE.ADMIN }).where(eq(users.id, user.id));

    const res = await getMe(buildApp(), cookie);

    expect(res.status).toBe(200);
    expect(((await res.json()) as MeResponse).isAdmin).toBe(true);
  });

  it("403s a caller whose role is revoked in the DB while the seed list is empty", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    const app = buildApp([user.id]);
    expect((await getAdminTeams(app, cookie)).status).toBe(200);

    await db.update(users).set({ appRole: APP_ROLE.USER }).where(eq(users.id, user.id));
    const unseeded = buildApp();

    const res = await getAdminTeams(unseeded, cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });
  });
});
