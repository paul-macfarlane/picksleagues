import { OpenAPIHono } from "@hono/zod-openapi";
import { ErrorResponseSchema } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { jobSecretMiddleware } from "../middleware/job-secret";

/**
 * Mounts `/jobs/*` behind the shared-secret guard. No concrete job routes
 * yet — sync jobs (DATA-4/5/6) register `createRoute` definitions here and
 * call `runJob` from their handlers. Mounted unconditionally in app.ts (per
 * meRoutes' idiom) so generate-openapi.ts — which builds the app with no
 * deps — still reflects this router in the committed spec; the guard 500s
 * defensively if `deps.env` is actually missing at request time, which real
 * deployments never hit.
 */
export function jobRoutes(deps: AppDeps) {
  const app = new OpenAPIHono({ defaultHook: zodValidationHook });

  app.use("/jobs/*", async (c, next) => {
    if (!deps.env) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Job secret is not configured.",
        }),
        500,
      );
    }
    return jobSecretMiddleware(deps.env.JOB_SECRET)(c, next);
  });

  return app;
}
