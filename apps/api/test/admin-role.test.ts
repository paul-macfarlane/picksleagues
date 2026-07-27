import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, users } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import { APP_ROLE, type MeResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

/**
 * App-wide admin capability lives in `users.app_role` and nowhere else
 * (ADR-0013): the column is what authorizes every request, and a direct
 * database update is the only way to grant or revoke it.
 */

const FIXED_NOW = new Date("2026-09-09T00:00:00.000Z");

const db = createDb(getTestDatabaseUrl());
// One `auth` shared by every app built below — cookies stay valid across them
// since they share `db` and makeTestEnv's `BETTER_AUTH_SECRET`.
const auth = createAuth({ env: makeTestEnv(), db });

function buildApp() {
  return createApp({
    auth,
    db,
    env: makeTestEnv(),
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

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("users.app_role as the authorization source", () => {
  it("grants admin routes to a DB-promoted user", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);

    const res = await getAdminTeams(buildApp(), cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teams: [] });
  });

  it("reports isAdmin off the column for a DB-promoted user", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);

    const res = await getMe(buildApp(), cookie);

    expect(res.status).toBe(200);
    expect(((await res.json()) as MeResponse).isAdmin).toBe(true);
  });

  it("403s a caller whose role is revoked in the DB, on their very next request", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    const app = buildApp();
    expect((await getAdminTeams(app, cookie)).status).toBe(200);

    await db.update(users).set({ appRole: APP_ROLE.USER }).where(eq(users.id, user.id));

    const res = await getAdminTeams(app, cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });
    const me = await getMe(app, cookie);
    expect(((await me.json()) as MeResponse).isAdmin).toBe(false);
  });
});
