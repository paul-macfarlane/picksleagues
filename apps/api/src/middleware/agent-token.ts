import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Env } from "@picksleagues/core";
import { ERROR_CODE, ErrorResponseSchema } from "@picksleagues/schemas";
import { logInfo } from "../lib/logger";

/** Authentication is separate from sessions/jobs, and unset configuration fails closed. */
export function agentTokenMiddleware(env?: Env): MiddlewareHandler {
  return async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const provided = /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(
      c.req.header("authorization") ?? "",
    )?.[1];
    const expected = env?.AGENT_API_TOKEN;
    const digest = (value: string) => createHash("sha256").update(value).digest();
    if (
      !provided ||
      !expected ||
      expected === env?.JOB_SECRET ||
      expected === env?.BETTER_AUTH_SECRET ||
      !timingSafeEqual(digest(provided), digest(expected))
    ) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json(
        ErrorResponseSchema.parse({ error: ERROR_CODE.UNAUTHORIZED, message: "Unauthorized." }),
        401,
      );
    }
    await next();
  };
}

/** Only fixed operation labels reach audit logs; caller paths/headers/payloads never do. */
export function agentOperation(path: string): string {
  if (path === "/api/agent/v1/system") return "agentSystem";
  if (/^\/api\/agent\/v1\/weeks\/[^/]+$/.test(path)) return "agentWeek";
  if (/^\/api\/agent\/v1\/games\/[^/]+$/.test(path)) return "agentGame";
  if (/^\/api\/agent\/v1\/league-seasons\/[^/]+\/diagnostics$/.test(path))
    return "agentLeagueDiagnostics";
  if (/^\/api\/agent\/v1\/league-seasons\/[^/]+\/reconciliation$/.test(path))
    return "agentScoringReconciliation";
  return "agentUnknown";
}

/** Platform timestamps accompany bounded request metadata, with a server-generated request ID. */
export function agentAuditMiddleware(env?: Env): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    const requestId = randomUUID();
    c.header("X-Request-Id", requestId);
    await next();
    logInfo("agent_request", {
      requestId,
      environment: env?.APP_ENV ?? "unconfigured",
      operation: agentOperation(c.req.path),
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  };
}
