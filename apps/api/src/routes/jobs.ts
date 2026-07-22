import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  JOB_RUN_STATUS,
  JobRunResponseSchema,
  WeekTypeSchema,
  type JobRunResponse,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { runJob } from "../lib/job-runner";
import { jobSecretMiddleware } from "../middleware/job-secret";
import { syncNflSchedule } from "../services/nfl/sync-schedule";
import { syncNflOdds } from "../services/nfl/sync-odds";
import { syncNflScores } from "../services/nfl/sync-scores";

/**
 * Optional overrides for the manual/simulator trigger path — cron fires the
 * jobs bare and they derive season/week from the Clock, but the admin page and
 * the simulator pass explicit values. Bounded so a typo can't request an
 * absurd season/week. `week` is 1-based within its `weekType` (regular 1–18,
 * postseason 1–5); an explicit `week` without `weekType` defaults to regular.
 */
const SyncQuerySchema = z.object({
  season: z.coerce.number().int().min(2000).max(2100).optional(),
  week: z.coerce.number().int().min(1).max(18).optional(),
  weekType: WeekTypeSchema.optional(),
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
  path: "/jobs/nfl/sync-schedule",
  operationId: "runNflSyncSchedule",
  summary: "Ingest the NFL schedule (regular season + postseason) into our tables",
  request: { query: SyncQuerySchema },
  responses: jobResponses,
});

const syncOddsRoute = createRoute({
  method: "post",
  path: "/jobs/nfl/sync-odds",
  operationId: "runNflSyncOdds",
  summary: "Snapshot spreads for unstarted games in the current NFL week",
  request: { query: SyncQuerySchema },
  responses: jobResponses,
});

const syncScoresRoute = createRoute({
  method: "post",
  path: "/jobs/nfl/sync-scores",
  operationId: "runNflSyncScores",
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
      return c.json(misconfigured("nfl-sync-schedule"), 500);
    }
    const clock = await resolveClock();
    const { season, week, weekType } = c.req.valid("query");
    return runJob(c, "nfl-sync-schedule", () =>
      syncNflSchedule(db, clock, provider, { seasonYear: season, weekType, weekNumber: week }),
    );
  });

  app.openapi(syncOddsRoute, async (c) => {
    const { db, provider, clock: resolveClock } = deps;
    if (!db || !resolveClock || !provider) {
      return c.json(misconfigured("nfl-sync-odds"), 500);
    }
    const clock = await resolveClock();
    const { season, week, weekType } = c.req.valid("query");
    return runJob(c, "nfl-sync-odds", () =>
      syncNflOdds(db, clock, provider, { seasonYear: season, weekType, weekNumber: week }),
    );
  });

  app.openapi(syncScoresRoute, async (c) => {
    const { db, provider, clock: resolveClock } = deps;
    if (!db || !resolveClock || !provider) {
      return c.json(misconfigured("nfl-sync-scores"), 500);
    }
    const clock = await resolveClock();
    const { season, week, weekType } = c.req.valid("query");
    return runJob(c, "nfl-sync-scores", () =>
      syncNflScores(db, clock, provider, { seasonYear: season, weekType, weekNumber: week }),
    );
  });

  return app;
}
