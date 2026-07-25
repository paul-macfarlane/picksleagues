import type { MiddlewareHandler } from "hono";
import { ERROR_CODE, ErrorResponseSchema } from "@picksleagues/schemas";
import type { Db } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import type { AppDeps } from "../deps";
import { adminMiddleware } from "../middleware/admin";
import { sessionMiddleware, type SessionVariables } from "../middleware/session";
import { seedAdminRole } from "../services/users";

export type DepsVariables = { db: Db; clock: Clock };

/**
 * Replaces the per-handler `if (!deps.db || !deps.clock) { ...misconfigured... }`
 * guard repeated across every route. Resolves `deps.clock()` exactly once per
 * request (not once per read inside the handler) — load-bearing for the
 * simulated clock, which must stay fixed for the duration of a single request.
 * A route that only needs `db` (e.g. GET /me) still gets `clock` resolved when
 * configured; it's simply unused by that handler.
 */
export function requireDbAndClock(deps: AppDeps): MiddlewareHandler<{ Variables: DepsVariables }> {
  return async (c, next) => {
    if (!deps.db || !deps.clock) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.MISCONFIGURED,
          message: "Database/clock are not configured.",
        }),
        500,
      );
    }
    const clock = await deps.clock();
    c.set("db", deps.db);
    c.set("clock", clock);
    await next();
  };
}

/**
 * Requires a valid Better Auth session. The missing-auth 500 defers to
 * request time rather than app-construction time: generate-openapi.ts builds
 * every route with no deps and never invokes handlers, so real deployments
 * (which always supply `deps.auth`) never hit it.
 *
 * Session resolution is also where the `ADMIN_USER_IDS` bootstrap seed is
 * applied (ADR-0013) — not in `requireAdmin`, because `GET /me` must report a
 * seeded admin's capability on their very first request (the SPA renders its
 * admin surfaces off that flag, so it never reaches an admin route first).
 */
export function requireSession(deps: AppDeps): MiddlewareHandler<{ Variables: SessionVariables }> {
  const { db, env } = deps;
  return async (c, next) => {
    if (!deps.auth) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.MISCONFIGURED,
          message: "Auth is not configured.",
        }),
        500,
      );
    }
    return sessionMiddleware(deps.auth)(c, async () => {
      if (db && env) {
        await seedAdminRole(db, c.get("sessionUser").id, env.ADMIN_USER_IDS);
      }
      await next();
    });
  };
}

/**
 * Requires the caller to hold the admin role. Mount after `requireSession` —
 * depends on `sessionUser` already being on the context. Reads `db` off `deps`
 * rather than the context (they are the same instance: `requireDbAndClock` sets
 * `deps.db`) so this stays mountable on the job/replay routes, which resolve
 * their own deps to keep a `JobRunResponse`-shaped misconfiguration 500.
 */
export function requireAdmin(deps: AppDeps): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    if (!deps.db) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.MISCONFIGURED,
          message: "Database is not configured.",
        }),
        500,
      );
    }
    return adminMiddleware(deps.db)(c, next);
  };
}
