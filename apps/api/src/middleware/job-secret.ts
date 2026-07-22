import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { ErrorResponseSchema } from "@picksleagues/schemas";

/**
 * `timingSafeEqual` throws on unequal-length buffers rather than returning
 * false, so length is checked first — that length check is itself
 * timing-observable, but the secret's length isn't the thing being protected.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Guards `/api/jobs/*`: requires the `x-job-secret` header to match
 * `JOB_SECRET` exactly. Shared-secret header per architecture's Background
 * Jobs section — jobs are triggered by an external scheduler (cron-job.org),
 * not a signed-in user, so there's no session to check.
 */
export function jobSecretMiddleware(jobSecret: string): MiddlewareHandler {
  return async (c, next) => {
    const provided = c.req.header("x-job-secret");
    if (!provided || !constantTimeEquals(provided, jobSecret)) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "unauthorized",
          message: "Missing or invalid job secret.",
        }),
        401,
      );
    }
    await next();
  };
}
