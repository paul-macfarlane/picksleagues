import type { Context } from "hono";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { jobHealth } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import { JOB_RUN_STATUS, type JobRunResponse } from "@picksleagues/schemas";
import type { Alerter } from "./alerting";
import { logError, logInfo } from "./logger";

type JobResult = Record<string, string | number | boolean>;

/**
 * A failure streak reaching exactly this length fires one alert (arch
 * §External Data). "Exactly" — not ">=" — so a streak alerts once; a later
 * success resets `consecutiveFailures` to 0 so a fresh streak can alert again.
 */
export const ALERT_AFTER_CONSECUTIVE_FAILURES = 3;

/**
 * Health-bookkeeping dependencies. All optional so `generate-openapi.ts` (which
 * builds the app with no deps) and the isolated `runJob` convention tests can
 * pass `{}`; when `db`/`clock` are absent, bookkeeping is skipped silently.
 */
type JobContext = { db?: Db; clock?: Clock; alerter?: Alerter };

/**
 * Single conventions-carrier for every `/api/jobs/*` handler: measures
 * duration, logs a structured completion/failure event, shapes the response as
 * the `JobRunResponse` envelope, and records per-job health for repeated-
 * failure alerting. `fn` must be idempotent — jobs are triggered by an external
 * scheduler and may be re-run or double-fired (a missed tick, a manual
 * re-trigger from the admin page), so `fn` should be safe to execute more than
 * once with the same effect as once.
 *
 * `performance.now()` is monotonic elapsed time, not a wall-clock "now" read
 * — it measures duration, not a domain timestamp, so it's exempt from the
 * Clock discipline (arch D13).
 */
// No explicit return type annotation: `c.json(body, status)` returns a
// `Response & TypedResponse<...>` narrowed to `body`'s type and the literal
// status code, and inference is what lets `app.openapi` handlers return this
// helper's result directly — annotating a wider type (e.g. `Response`) would
// erase that narrowing and break every call site's route-response check.
export async function runJob(
  c: Context,
  jobName: string,
  ctx: JobContext,
  fn: () => Promise<JobResult>,
) {
  const startedAt = performance.now();
  try {
    const details = await fn();
    const durationMs = performance.now() - startedAt;
    logInfo("job.completed", { job: jobName, durationMs, ...details });
    await recordSuccess(ctx, jobName);
    const body: JobRunResponse = {
      job: jobName,
      status: JOB_RUN_STATUS.OK,
      durationMs,
      details,
    };
    return c.json(body, 200);
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    logError("job.failed", { job: jobName, durationMs, error });
    const message = error instanceof Error ? error.message : "Job failed.";
    await recordFailure(ctx, jobName, message);
    const body: JobRunResponse = {
      job: jobName,
      status: JOB_RUN_STATUS.ERROR,
      durationMs,
      message,
    };
    return c.json(body, 500);
  }
}

/** Resets the streak. Best-effort: a bookkeeping failure never alters the job response. */
async function recordSuccess(ctx: JobContext, jobName: string): Promise<void> {
  if (!ctx.db || !ctx.clock) return;
  const now = ctx.clock.now();
  try {
    await ctx.db
      .insert(jobHealth)
      .values({ jobName, consecutiveFailures: 0, lastSuccessAt: now })
      .onConflictDoUpdate({
        target: jobHealth.jobName,
        set: { consecutiveFailures: 0, lastSuccessAt: now },
      });
  } catch (error) {
    logError("job_health.update_failed", { job: jobName, error });
  }
}

/**
 * Increments the streak and, when it reaches exactly the alert threshold, fires
 * the alerter once and stamps `lastAlertedAt`. Best-effort: its own try/catch
 * so a bookkeeping or alert failure never alters the job response.
 */
async function recordFailure(ctx: JobContext, jobName: string, message: string): Promise<void> {
  if (!ctx.db || !ctx.clock) return;
  // Accepted risk (ADR-0007): the failure streak lives in the same Postgres the
  // jobs read, so a full DB outage suppresses this alert path by design.
  // cron-job.org's own failure notifications (jobs return 500) cover that mode;
  // this webhook exists for app-level failures where the DB is healthy.
  const now = ctx.clock.now();
  try {
    const [row] = await ctx.db
      .insert(jobHealth)
      .values({ jobName, consecutiveFailures: 1, lastFailureAt: now })
      .onConflictDoUpdate({
        target: jobHealth.jobName,
        // Current-value arithmetic: in ON CONFLICT DO UPDATE a bare column
        // reference resolves to the existing row's value, so this increments.
        set: { consecutiveFailures: sql`${jobHealth.consecutiveFailures} + 1`, lastFailureAt: now },
      })
      .returning({ consecutiveFailures: jobHealth.consecutiveFailures });

    const consecutiveFailures = row?.consecutiveFailures ?? 0;
    if (consecutiveFailures === ALERT_AFTER_CONSECUTIVE_FAILURES && ctx.alerter) {
      await ctx.alerter({ jobName, message, consecutiveFailures });
      await ctx.db
        .update(jobHealth)
        .set({ lastAlertedAt: now })
        .where(eq(jobHealth.jobName, jobName));
    }
  } catch (error) {
    logError("job_health.update_failed", { job: jobName, error });
  }
}
