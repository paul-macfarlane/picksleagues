import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth, buildApp, closeSimDb, db, get, withCookie } from "./setup/sim-helpers";
import { createAuthenticatedUser, grantAdmin } from "./setup/auth-helpers";
import { resetDb } from "./setup/reset-db";

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeSimDb();
});

// ---------------------------------------------------------------------------
// Route gating (ADR-0011): session + admin role on every route, and
// non-registration in production.
// ---------------------------------------------------------------------------

const SIM_ROUTE_CASES: { method: string; path: string; body?: unknown }[] = [
  { method: "GET", path: "/api/sim/state" },
  { method: "POST", path: "/api/sim/clock", body: { kind: "reset" } },
  { method: "POST", path: "/api/sim/scenarios/mixed-week/load" },
  { method: "POST", path: "/api/sim/scenarios/replay", body: { seasonYear: 2020 } },
  {
    method: "GET",
    path: "/api/sim/fixtures/games?scenarioId=00000000-0000-4000-8000-000000000000",
  },
  {
    method: "PATCH",
    path: "/api/sim/fixtures/games/00000000-0000-4000-8000-000000000000",
    body: { spread: 1 },
  },
  { method: "POST", path: "/api/sim/reset", body: { scope: "environment" } },
];

function requestRoute(
  app: ReturnType<typeof buildApp>,
  route: { method: string; path: string; body?: unknown },
  cookie?: string,
) {
  return app.request(route.path, {
    method: route.method,
    headers: {
      ...(route.body !== undefined ? { "content-type": "application/json" } : {}),
      ...withCookie(cookie),
    },
    body: route.body !== undefined ? JSON.stringify(route.body) : undefined,
  });
}

describe("sim route gating", () => {
  it.each(SIM_ROUTE_CASES)("401s with no session cookie: $method $path", async (route) => {
    const app = buildApp();

    const res = await requestRoute(app, route);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it.each(SIM_ROUTE_CASES)(
    "403s for a signed-in non-admin caller: $method $path",
    async (route) => {
      const { cookie } = await createAuthenticatedUser(auth);
      const app = buildApp();

      const res = await requestRoute(app, route, cookie);

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "not_admin" });
    },
  );

  it("production: sim routes are not registered at all — GET /api/sim/state 404s even for an admin (ADR-0011)", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    const app = buildApp({ envOverrides: { APP_ENV: "production" } });

    const res = await get(app, "/api/sim/state", cookie);

    expect(res.status).toBe(404);
  });

  it("SIM_ENABLED=false in a non-prod env: sim routes are not registered — GET /api/sim/state 404s for an admin", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    const app = buildApp({
      envOverrides: { APP_ENV: "local", SIM_ENABLED: false },
    });

    const res = await get(app, "/api/sim/state", cookie);

    expect(res.status).toBe(404);
  });

  it("production overrides SIM_ENABLED=true: sim routes stay unregistered — GET /api/sim/state 404s for an admin", async () => {
    const { user, cookie } = await createAuthenticatedUser(auth);
    await grantAdmin(db, user.id);
    const app = buildApp({
      envOverrides: { APP_ENV: "production", SIM_ENABLED: true },
    });

    const res = await get(app, "/api/sim/state", cookie);

    expect(res.status).toBe(404);
  });
});
