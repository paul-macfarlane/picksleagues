import type { MiddlewareHandler } from "hono";
import { ERROR_CODE, ErrorResponseSchema } from "@picksleagues/schemas";
import type { Db } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import type { AppDeps } from "../deps";
import { sessionMiddleware, type SessionVariables } from "../middleware/session";

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
 */
export function requireSession(deps: AppDeps): MiddlewareHandler<{ Variables: SessionVariables }> {
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
    return sessionMiddleware(deps.auth)(c, next);
  };
}
