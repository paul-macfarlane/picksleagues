import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { NflSyncJobSchema } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { errorResponse, NOT_ADMIN_403, UNAUTHENTICATED_401 } from "../lib/route-responses";
import {
  jobRunResponses,
  misconfiguredJob,
  NFL_SYNC_JOBS,
  SyncQuerySchema,
} from "../lib/nfl-sync-jobs";
import { runJob } from "../lib/job-runner";
import { requireAdmin, requireSession } from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";

const AdminNflJobParamsSchema = z.object({ job: NflSyncJobSchema });

const runAdminNflJobRoute = createRoute({
  method: "post",
  path: "/admin/jobs/nfl/{job}",
  operationId: "runAdminNflJob",
  summary: "Manually trigger an NFL data sync job",
  request: { params: AdminNflJobParamsSchema, query: SyncQuerySchema },
  responses: {
    200: jobRunResponses[200],
    400: errorResponse(
      "Invalid job slug, or a supplied query param (season/week) fails its format rule",
    ),
    401: UNAUTHENTICATED_401,
    403: NOT_ADMIN_403,
    500: jobRunResponses[500],
  },
});

/**
 * Admin-triggered counterpart to `/api/jobs/nfl/*` (ADR-0011): the SPA can't
 * hold the cron shared secret, so admins trigger the same sync jobs through a
 * session+allowlist-guarded surface that dispatches to the identical service
 * calls via the shared `NFL_SYNC_JOBS` registry. Mounted unconditionally in
 * app.ts (the admin surface exists in every env; server-side allowlist gates
 * it, not env registration).
 */
export function adminRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables }>({ defaultHook: zodValidationHook });

  app.use("/admin/*", requireSession(deps));
  app.use("/admin/*", requireAdmin(deps));

  app.openapi(runAdminNflJobRoute, async (c) => {
    const { db, provider, clock: resolveClock } = deps;
    const { job } = c.req.valid("param");
    const entry = NFL_SYNC_JOBS[job];
    if (!db || !resolveClock || !provider) {
      return c.json(misconfiguredJob(entry.jobName), 500);
    }
    const clock = await resolveClock();
    const { season, week, weekType } = c.req.valid("query");
    return runJob(c, entry.jobName, () =>
      entry.run(db, clock, provider, { seasonYear: season, weekType, weekNumber: week }),
    );
  });

  return app;
}
