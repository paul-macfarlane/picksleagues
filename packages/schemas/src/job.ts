import { z } from "@hono/zod-openapi";

export const JOB_RUN_STATUS = {
  OK: "ok",
  /**
   * The job ran to completion but had nothing to do (`details.skipped`) — a
   * distinct outcome from OK so an operator triggering a job manually can tell
   * "nothing happened" from "work happened". Still a 2xx: a skip is not a
   * failure, and only real failures may trip the cron scheduler's notifications
   * (ADR-0007).
   */
  SKIPPED: "skipped",
  ERROR: "error",
} as const;

export type JobRunStatus = (typeof JOB_RUN_STATUS)[keyof typeof JOB_RUN_STATUS];

/**
 * Why a job run had nothing to do — the `details.reason` slug behind
 * `JOB_RUN_STATUS.SKIPPED`. Lives here (not in the services) because it is a
 * wire value the admin page maps to operator-facing copy.
 */
export const JOB_SKIP_REASON = {
  /** The targeted season has no rows yet — schedule-sync owns creating them. */
  SEASON_NOT_SYNCED: "season_not_synced",
  /** An explicitly requested week has no row in the targeted season. */
  WEEK_NOT_SYNCED: "week_not_synced",
  /** Derived path: the targeted season has no in-progress or upcoming week. */
  NO_CURRENT_WEEK: "no_current_week",
  /** Score sync's gate: nothing has kicked off that is still unresolved. */
  NO_ACTIVE_GAMES: "no_active_games",
} as const;

export type JobSkipReason = (typeof JOB_SKIP_REASON)[keyof typeof JOB_SKIP_REASON];

/**
 * The NFL data-sync jobs an admin can trigger manually from the admin page —
 * same set the cron scheduler fires on a timer (apps/api/src/routes/jobs.ts).
 */
export const NFL_SYNC_JOB = {
  SYNC_SCHEDULE: "sync-schedule",
  SYNC_ODDS: "sync-odds",
  SYNC_SCORES: "sync-scores",
  SYNC_STATS: "sync-stats",
} as const;

export type NflSyncJob = (typeof NFL_SYNC_JOB)[keyof typeof NFL_SYNC_JOB];

export const NflSyncJobSchema = z.enum(NFL_SYNC_JOB).openapi("NflSyncJob");

/**
 * Uniform response envelope for every `/api/jobs/*` endpoint. `details` carries
 * per-job counters (rows upserted, transitions detected, …) — scalar values
 * only, so the envelope stays renderable by a future admin page without
 * per-job UI code. A run that had nothing to do reports `status: "skipped"`
 * with `details.skipped`/`details.reason` (a `JOB_SKIP_REASON`).
 */
export const JobRunResponseSchema = z
  .object({
    job: z.string(),
    status: z.enum(JOB_RUN_STATUS),
    durationMs: z.number(),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    message: z.string().optional(),
  })
  .openapi("JobRunResponse");

export type JobRunResponse = z.infer<typeof JobRunResponseSchema>;
