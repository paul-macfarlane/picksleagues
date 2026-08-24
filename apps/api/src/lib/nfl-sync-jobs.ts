import { z } from "@hono/zod-openapi";
import type { Db } from "@picksleagues/db";
import type { Clock, GameDataProvider } from "@picksleagues/core";
import type { AppDeps } from "../deps";
import {
  JOB_RUN_STATUS,
  JobRunResponseSchema,
  NFL_SYNC_JOB,
  WeekTypeSchema,
  type JobRunResponse,
  type NflSyncJob,
  type WeekType,
} from "@picksleagues/schemas";
import { syncNflSchedule } from "../services/nfl/sync-schedule";
import { syncNflOdds } from "../services/nfl/sync-odds";
import { syncNflScores } from "../services/nfl/sync-scores";
import { syncNflStats } from "../services/nfl/sync-stats";

/**
 * Optional overrides for the manual/simulator/admin trigger path — cron fires
 * the jobs bare and they derive season/week from the Clock, but the admin
 * page and the simulator pass explicit values. Bounded so a typo can't
 * request an absurd season/week. `week` is 1-based within its `weekType`
 * (regular 1–18, postseason 1–5); an explicit `week` without `weekType`
 * defaults to regular.
 */
export const SyncQuerySchema = z.object({
  season: z.coerce.number().int().min(2000).max(2100).optional(),
  week: z.coerce.number().int().min(1).max(18).optional(),
  weekType: WeekTypeSchema.optional(),
});

type SyncOpts = { seasonYear?: number; weekType?: WeekType; weekNumber?: number };

/**
 * One entry per NFL sync job, shared by `/api/jobs/nfl/*` (cron, shared-secret
 * guarded) and `/api/admin/jobs/nfl/{job}` (session+admin guarded) so both
 * surfaces dispatch to the exact same service call. `jobName` is the string
 * threaded into `runJob`'s envelope/logging — kept identical to the
 * pre-existing `/jobs/nfl/*` names since logs/cron dashboards reference them.
 */
export const NFL_SYNC_JOBS: Record<
  NflSyncJob,
  {
    jobName: string;
    run: (
      db: Db,
      clock: Clock,
      provider: GameDataProvider,
      opts: SyncOpts,
    ) => Promise<Record<string, string | number | boolean>>;
  }
> = {
  [NFL_SYNC_JOB.SYNC_SCHEDULE]: { jobName: "nfl-sync-schedule", run: syncNflSchedule },
  [NFL_SYNC_JOB.SYNC_ODDS]: { jobName: "nfl-sync-odds", run: syncNflOdds },
  [NFL_SYNC_JOB.SYNC_SCORES]: { jobName: "nfl-sync-scores", run: syncNflScores },
  [NFL_SYNC_JOB.SYNC_STATS]: { jobName: "nfl-sync-stats", run: syncNflStats },
};

/**
 * Resolves the trio every sync-job handler needs, in the one order that keeps
 * them consistent: the clock first, then the provider *for that clock* — a
 * simulated provider projects fixtures against it, so they must be the same
 * instant. Shared by `/api/jobs/nfl/*` and `/api/admin/jobs/nfl/{job}`, which
 * would otherwise each restate the resolution and could drift apart.
 *
 * Null means a dependency is missing; callers turn that into `misconfiguredJob`
 * so the 500 keeps the `JobRunResponse` shape.
 */
export async function resolveNflJobDeps(
  deps: AppDeps,
): Promise<{ db: Db; clock: Clock; provider: GameDataProvider } | null> {
  const { db, clock: resolveClock, provider: resolveProvider } = deps;
  if (!db || !resolveClock || !resolveProvider) {
    return null;
  }
  const clock = await resolveClock();
  return { db, clock, provider: await resolveProvider(clock) };
}

/**
 * The provider-less sibling of `resolveNflJobDeps` for jobs that only read and
 * write our own tables (the settlement sweep, a league rebuild). Same null
 * contract, same single clock resolution per request — the four handlers that
 * restated `if (!db || !resolveClock)` inline each had to remember that rule
 * on their own.
 */
export async function resolveJobDeps(deps: AppDeps): Promise<{ db: Db; clock: Clock } | null> {
  const { db, clock: resolveClock } = deps;
  if (!db || !resolveClock) return null;
  return { db, clock: await resolveClock() };
}

/**
 * Deviates from the me.ts idiom (which 500s with ErrorResponseSchema): job
 * endpoints keep exactly one 500 shape in the contract — the `JobRunResponse`
 * failure envelope — so a missing-deps 500 and a job-failure 500 are the same
 * shape the admin page renders. Structurally unreachable outside
 * generate-openapi.ts, which builds the app with no deps.
 */
export function misconfiguredJob(jobName: string): JobRunResponse {
  return {
    job: jobName,
    status: JOB_RUN_STATUS.ERROR,
    durationMs: 0,
    message: "Database/clock/provider are not configured.",
  };
}

/**
 * The 200/500 response shape every NFL-sync-job route shares — `/api/jobs/*`
 * (shared-secret guarded) and `/api/admin/jobs/*` (session+admin guarded)
 * both dispatch through `runJob`, so both must declare the same envelope for
 * both outcomes; each route file adds its own 400/401/403 on top.
 */
export const jobRunResponses = {
  200: {
    description: "Job completed — counters in `details`",
    content: { "application/json": { schema: JobRunResponseSchema } },
  },
  500: {
    description: "Job failed, or a dependency is not configured — same envelope either way",
    content: { "application/json": { schema: JobRunResponseSchema } },
  },
} as const;
