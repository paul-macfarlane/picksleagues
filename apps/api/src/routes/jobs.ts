import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ERROR_CODE, ErrorResponseSchema, NFL_SYNC_JOB } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { runJob } from "../lib/job-runner";
import {
  jobRunResponses,
  misconfiguredJob,
  NFL_SYNC_JOBS,
  resolveJobDeps,
  resolveNflJobDeps,
  SyncQuerySchema,
} from "../lib/nfl-sync-jobs";
import { errorResponse } from "../lib/route-responses";
import { jobSecretMiddleware } from "../middleware/job-secret";
import { SETTLE_SWEEP_JOB_NAME } from "../lib/settlement-job";
import { settleSweep } from "../services/settlement";

const jobResponses = {
  200: jobRunResponses[200],
  400: errorResponse("A supplied query param (season/week) fails its format rule"),
  401: errorResponse("Missing or wrong x-job-secret header"),
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
  [NFL_SYNC_JOB.SYNC_STATS]: createRoute({
    method: "post",
    path: "/jobs/nfl/sync-stats",
    operationId: "runNflSyncStats",
    summary: "Refresh team season records and per-game matchup context (ADR-0040)",
    request: { query: SyncQuerySchema },
    responses: jobResponses,
  }),
} as const;

/**
 * Not part of `NFL_SYNC_JOBS`: the nightly reconciliation is mode-agnostic and
 * takes no provider (it recomputes from our own stored results, arch D10), so
 * it shares the envelope but not the registry, whose whole shape is
 * "(db, clock, provider, week opts)".
 */
const settleSweepRoute = createRoute({
  method: "post",
  path: "/jobs/settle-sweep",
  operationId: "runSettleSweep",
  summary: "Recompute results and standings for every active league season",
  responses: { 200: jobRunResponses[200], 401: jobResponses[401], 500: jobRunResponses[500] },
});

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
      const resolved = await resolveNflJobDeps(deps);
      if (!resolved) {
        return c.json(misconfiguredJob(entry.jobName), 500);
      }
      const { season, week, weekType } = c.req.valid("query");
      return runJob(c, entry.jobName, () =>
        entry.run(resolved.db, resolved.clock, resolved.provider, {
          seasonYear: season,
          weekType,
          weekNumber: week,
        }),
      );
    });
  }

  app.openapi(settleSweepRoute, async (c) => {
    const resolved = await resolveJobDeps(deps);
    if (!resolved) return c.json(misconfiguredJob(SETTLE_SWEEP_JOB_NAME), 500);
    const { db, clock } = resolved;
    return runJob(c, SETTLE_SWEEP_JOB_NAME, () => settleSweep(db, clock));
  });

  return app;
}
