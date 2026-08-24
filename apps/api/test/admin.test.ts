import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { JobRunResponse } from "@picksleagues/schemas";
import { BaseFakeProvider } from "./setup/fake-provider";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import { resetDb } from "./setup/reset-db";
import { makeFixedAppHarness, withCookie } from "./setup/fixed-app";

const FIXED_NOW = new Date("2026-09-09T00:00:00.000Z");

/** Never exercised by these tests — no games are seeded, so every sync job's
 * fast no-op path returns before touching the provider. */
class FakeProvider extends BaseFakeProvider {}

const provider = new FakeProvider();
const { db, auth, appAt } = makeFixedAppHarness();

function buildApp() {
  return appAt(FIXED_NOW, { provider: async () => provider });
}

function postAdminJob(app: ReturnType<typeof buildApp>, job: string, cookie: string | undefined) {
  return app.request(`/api/admin/jobs/nfl/${job}`, {
    method: "POST",
    headers: withCookie(cookie),
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

describe("POST /api/admin/jobs/settle-sweep", () => {
  function postSettleSweep(app: ReturnType<typeof buildApp>, cookie: string | undefined) {
    return app.request("/api/admin/jobs/settle-sweep", {
      method: "POST",
      headers: withCookie(cookie),
    });
  }

  it("401s with no session cookie", async () => {
    const app = buildApp();

    const res = await postSettleSweep(app, undefined);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("403s for an authenticated caller who isn't an admin", async () => {
    const app = buildApp();
    const { cookie } = await createAuthenticatedUser(auth);

    const res = await postSettleSweep(app, cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });
  });

  it("200s with the sweep summary for an admin caller", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    const app = buildApp();

    const res = await postSettleSweep(app, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.job).toBe("settle-sweep");
    // The sweep never skips: with no active league seasons seeded it still
    // completes, reporting an empty summary rather than a skip envelope.
    expect(body.status).toBe("ok");
    expect(body.details).toMatchObject({ leagueSeasons: 0, results: 0, failed: 0 });
  });
});
