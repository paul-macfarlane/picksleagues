import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@picksleagues/db";
import { APP_ROLE, type MeResponse } from "@picksleagues/schemas";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness } from "./setup/fixed-app";

/**
 * App-wide admin capability lives in `users.app_role` and nowhere else
 * (ADR-0013): the column is what authorizes every request, and a direct
 * database update is the only way to grant or revoke it.
 */

const FIXED_NOW = new Date("2026-09-09T00:00:00.000Z");

const { db, auth, appAt } = makeFixedAppHarness();

function buildApp() {
  return appAt(FIXED_NOW);
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
