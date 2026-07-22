import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  JOB_RUN_STATUS,
  JobRunResponseSchema,
  type JobRunResponse,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { runJob } from "../lib/job-runner";
import { jobSecretMiddleware } from "../middleware/job-secret";
import { syncSchedule } from "../services/sync-schedule";
import { syncOdds } from "../services/sync-odds";
import { syncScores } from "../services/sync-scores";

/**
 * Optional overrides for the manual/simulator trigger path — cron fires the
 * jobs bare and they derive season/week from the Clock, but the admin page and
 * the simulator pass explicit values. Bounded so a typo can't request an
 * absurd season/week.
 */
const SyncQuerySchema = z.object({
  season: z.coerce.number().int().min(2000).max(2100).optional(),
  week: z.coerce.number().int().min(1).max(18).optional(),
});

const jobResponses = {
  200: {
    description: "Job completed — counters in `details`",
    content: { "application/json": { schema: JobRunResponseSchema } },
  },
  400: {
    description: "A supplied query param (season/week) fails its format rule",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
  401: {
    description: "Missing or wrong x-job-secret header",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
  500: {
    description: "Job failed, or a dependency is not configured — same envelope either way",
    content: { "application/json": { schema: JobRunResponseSchema } },
  },
} as const;

const syncScheduleRoute = createRoute({
  method: "post",
  path: "/jobs/sync-schedule",
  operationId: "runSyncSchedule",
  summary: "Ingest the NFL schedule from the provider into our tables",
  request: { query: SyncQuerySchema },
  responses: jobResponses,
});

const syncOddsRoute = createRoute({
  method: "post",
  path: "/jobs/sync-odds",
  operationId: "runSyncOdds",
  summary: "Snapshot spreads for unstarted games in the current NFL week",
  request: { query: SyncQuerySchema },
  responses: jobResponses,
});

const syncScoresRoute = createRoute({
  method: "post",
  path: "/jobs/sync-scores",
  operationId: "runSyncScores",
  summary: "Refresh live scores/statuses for in-flight NFL games from the provider",
  request: { query: SyncQuerySchema },
  responses: jobResponses,
});

/**
 * Deviates from the me.ts idiom (which 500s with ErrorResponseSchema): job
 * endpoints keep exactly one 500 shape in the contract — the `JobRunResponse`
 * failure envelope — so a missing-deps 500 and a job-failure 500 are the same
 * shape the (future) admin page renders. Structurally unreachable outside
 * generate-openapi.ts, which builds the app with no deps.
 */
function misconfigured(jobName: string): JobRunResponse {
  return {
    job: jobName,
    status: JOB_RUN_STATUS.ERROR,
    durationMs: 0,
    message: "Database/clock/provider are not configured.",
  };
}

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
          error: "misconfigured",
          message: "Job secret is not configured.",
        }),
        500,
      );
    }
    return jobSecretMiddleware(deps.env.JOB_SECRET)(c, next);
  });

  app.openapi(syncScheduleRoute, async (c) => {
    const { db, provider, clock: resolveClock } = deps;
    if (!db || !resolveClock || !provider) {
      return c.json(misconfigured("sync-schedule"), 500);
    }
    const clock = await resolveClock();
    const { season, week } = c.req.valid("query");
    return runJob(c, "sync-schedule", { db, clock, alerter: deps.alerter }, () =>
      syncSchedule(db, clock, provider, { seasonYear: season, weekNumber: week }),
    );
  });

  app.openapi(syncOddsRoute, async (c) => {
    const { db, provider, clock: resolveClock } = deps;
    if (!db || !resolveClock || !provider) {
      return c.json(misconfigured("sync-odds"), 500);
    }
    const clock = await resolveClock();
    const { season, week } = c.req.valid("query");
    return runJob(c, "sync-odds", { db, clock, alerter: deps.alerter }, () =>
      syncOdds(db, clock, provider, { seasonYear: season, weekNumber: week }),
    );
  });

  app.openapi(syncScoresRoute, async (c) => {
    const { db, provider, clock: resolveClock } = deps;
    if (!db || !resolveClock || !provider) {
      return c.json(misconfigured("sync-scores"), 500);
    }
    const clock = await resolveClock();
    const { season, week } = c.req.valid("query");
    return runJob(c, "sync-scores", { db, clock, alerter: deps.alerter }, () =>
      syncScores(db, clock, provider, { seasonYear: season, weekNumber: week }),
    );
  });

  return app;
}
