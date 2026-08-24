import { createDb } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import type { AppDeps } from "../../src/deps";
import { createAuthenticatedUser, grantAdmin } from "./auth-helpers";
import { getTestDatabaseUrl } from "./test-database-url";
import { makeTestEnv } from "./test-env";

/**
 * The db/auth/app trio for a test file that pins the clock: every admin and
 * NFL-surface integration test builds the same three objects, and each copy
 * had to remember on its own that one `auth` must be shared by every app it
 * builds (cookies stay valid across apps only because they share `db` and
 * `makeTestEnv`'s secret). The league surfaces use `makeLeagueTestHarness`,
 * which additionally binds the pick/standings request helpers to three
 * pre-built apps around the seeded kickoff; the sim surfaces use
 * `sim-helpers`' `buildApp`, whose clock reads the persisted offset.
 *
 * Caller owns the pool's lifecycle — `afterAll(() => db.$client.end())`.
 */
export function makeFixedAppHarness() {
  const db = createDb(getTestDatabaseUrl());
  const auth = createAuth({ env: makeTestEnv(), db });

  /** An app whose clock is pinned at `now`; `extra` adds a provider or env. */
  function appAt(now: Date, extra: Partial<AppDeps> = {}) {
    return createApp({
      auth,
      db,
      env: makeTestEnv(),
      clock: async () => new FixedClock(now),
      ...extra,
    });
  }

  /** Signs in a user, grants them the admin role, and hands back the app to call with. */
  async function adminCaller<A>(
    app: A,
    overrides: { displayName?: string; username?: string } = {},
  ) {
    const { user, cookie } = await createAuthenticatedUser(auth, overrides);
    await grantAdmin(db, user.id);
    return { app, cookie, userId: user.id };
  }

  return { db, auth, appAt, adminCaller };
}

/** Request headers for an optionally signed-in caller. */
export function withCookie(cookie: string | undefined): Record<string, string> {
  return cookie ? { cookie } : {};
}
