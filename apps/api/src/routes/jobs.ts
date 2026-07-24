import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ERROR_CODE, ErrorResponseSchema, NFL_SYNC_JOB } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { runJob } from "../lib/job-runner";
import {
  jobRunResponses,
  misconfiguredJob,
  NFL_SYNC_JOBS,
  SyncQuerySchema,
} from "../lib/nfl-sync-jobs";
import { jobSecretMiddleware } from "../middleware/job-secret";

const jobResponses = {
  200: jobRunResponses[200],
  400: {
    description: "A supplied query param (season/week) fails its format rule",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
  401: {
    description: "Missing or wrong x-job-secret header",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
  500: jobRunResponses[500],
} as const;

/**
 * Each `/jobs/nfl/{job}` route, paths/operationIds/summaries pinned exactly
 * as before the registry extraction — cron-job.org has these URLs configured
 * already, and the OpenAPI contract must not shift under them.
 */
const nflSyncRoutes = {
  [NFL_SYNC_JOB.SYNC_SCHEDULE]: createRoute({
    method: "post",
    path: "/jobs/nfl/sync-schedule",
    operationId: "runNflSyncSchedule",
    summary: "Ingest the NFL schedule (regular season + postseason) into our tables",
    request: { query: SyncQuerySchema },
    responses: jobResponses,
  }),
  [NFL_SYNC_JOB.SYNC_ODDS]: createRoute({
    method: "post",
    path: "/jobs/nfl/sync-odds",
    operationId: "runNflSyncOdds",
    summary: "Snapshot spreads for unstarted games in the current NFL week",
    request: { query: SyncQuerySchema },
    responses: jobResponses,
  }),
  [NFL_SYNC_JOB.SYNC_SCORES]: createRoute({
    method: "post",
    path: "/jobs/nfl/sync-scores",
    operationId: "runNflSyncScores",
    summary: "Refresh live scores/statuses for in-flight NFL games from the provider",
    request: { query: SyncQuerySchema },
    responses: jobResponses,
  }),
} as const;

/**
 * Mounts `/jobs/*` behind the shared-secret guard (DATA-4/5). Mounted
 * unconditionally in app.ts (per meRoutes' idiom) so generate-openapi.ts —
 * which builds the app with no deps — still reflects these routes in the
 * committed spec; the guard 500s defensively if `deps.env` is actually missing
 * at request time, which real deployments never hit.
 */
export function jobRoutes(deps: AppDeps) {
  const app = new OpenAPIHono({ defaultHook: zodValidationHook });

  app.use("/jobs/*", async (c, next) => {
    if (!deps.env) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.MISCONFIGURED,
          message: "Job secret is not configured.",
        }),
        500,
      );
    }
    return jobSecretMiddleware(deps.env.JOB_SECRET)(c, next);
  });

  for (const job of Object.values(NFL_SYNC_JOB)) {
    const entry = NFL_SYNC_JOBS[job];
    app.openapi(nflSyncRoutes[job], async (c) => {
      const { db, provider, clock: resolveClock } = deps;
      if (!db || !resolveClock || !provider) {
        return c.json(misconfiguredJob(entry.jobName), 500);
      }
      const clock = await resolveClock();
      const { season, week, weekType } = c.req.valid("query");
      return runJob(c, entry.jobName, () =>
        entry.run(db, clock, provider, { seasonYear: season, weekType, weekNumber: week }),
      );
    });
  }

  return app;
}
