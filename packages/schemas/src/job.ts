import { z } from "@hono/zod-openapi";

export const JOB_RUN_STATUS = {
  OK: "ok",
  ERROR: "error",
} as const;

export type JobRunStatus = (typeof JOB_RUN_STATUS)[keyof typeof JOB_RUN_STATUS];

/**
 * Uniform response envelope for every `/api/jobs/*` endpoint. `details` carries
 * per-job counters (rows upserted, transitions detected, …) — scalar values
 * only, so the envelope stays renderable by a future admin page without
 * per-job UI code.
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
