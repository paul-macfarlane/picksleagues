import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import type { JobRunResponse } from "@picksleagues/schemas";
import { createApp } from "../src/app";
import { BaseFakeProvider } from "./setup/fake-provider";
import { createAuth } from "../src/auth";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import { resetDb } from "./setup/reset-db";
import { getTestDatabaseUrl } from "./setup/test-database-url";
import { makeTestEnv } from "./setup/test-env";

const FIXED_NOW = new Date("2026-09-09T00:00:00.000Z");

/** Never exercised by these tests — no games are seeded, so every sync job's
 * fast no-op path returns before touching the provider. */
class FakeProvider extends BaseFakeProvider {}

const db = createDb(getTestDatabaseUrl());
const provider = new FakeProvider();
// One `auth` instance shared by every app built below — session cookies it
// mints stay valid across them since they all share `db` and the same
// `BETTER_AUTH_SECRET` (makeTestEnv's default).
const auth = createAuth({ env: makeTestEnv(), db });

function buildApp() {
  return createApp({
    auth,
    db,
    env: makeTestEnv(),
    clock: async () => new FixedClock(FIXED_NOW),
    provider: async () => provider,
  });
}

function postAdminJob(app: ReturnType<typeof buildApp>, job: string, cookie: string | undefined) {
  return app.request(`/api/admin/jobs/nfl/${job}`, {
    method: "POST",
    headers: { ...(cookie ? { cookie } : {}) },
  });
}

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("POST /api/admin/jobs/nfl/{job}", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();

    const res = await postAdminJob(app, "sync-scores", undefined);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("403s for an authenticated caller who isn't an admin", async () => {
    const app = buildApp();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postAdminJob(app, "sync-scores", cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });
  });

  it("400s on an invalid job slug for an admin caller", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    const app = buildApp();

    const res = await postAdminJob(app, "not-a-real-job", cookie);

    expect(res.status).toBe(400);
  });

  it("200s and runs the job for an admin caller", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    const app = buildApp();

    const res = await postAdminJob(app, "sync-scores", cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.job).toBe("nfl-sync-scores");
    // Nothing is in flight in this fixture, so the run is a no-op — still 200,
    // but the envelope says so rather than looking like real work happened.
    expect(body.status).toBe("skipped");
    expect(body.details).toMatchObject({ skipped: true, reason: "no_active_games" });
  });
});
