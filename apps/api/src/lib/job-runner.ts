import type { Context } from "hono";
import { JOB_RUN_STATUS, type JobRunResponse } from "@picksleagues/schemas";
import { logError, logInfo } from "./logger";

type JobResult = Record<string, string | number | boolean>;

/**
 * Single conventions-carrier for every `/api/jobs/*` handler: measures
 * duration, logs a structured completion/failure event, and shapes the
 * response as the `JobRunResponse` envelope. `fn` must be idempotent — jobs
 * are triggered by an external scheduler and may be re-run or double-fired (a
 * missed tick, a manual re-trigger from the admin page), so `fn` should be
 * safe to execute more than once with the same effect as once. Failure
 * notification is delegated to the cron scheduler: jobs return 500 and
 * cron-job.org emails on failed requests.
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
export async function runJob(c: Context, jobName: string, fn: () => Promise<JobResult>) {
  const startedAt = performance.now();
  try {
    const details = await fn();
    const durationMs = performance.now() - startedAt;
    logInfo("job.completed", { job: jobName, durationMs, ...details });
    const body: JobRunResponse = {
      job: jobName,
      // A job that had nothing to do says so in its own result (`details.skipped`
      // + a `JOB_SKIP_REASON`); promoting it to the envelope's status is what
      // lets the admin page distinguish a no-op from real work. Deliberately
      // still 200 — a skip is not a failure, and only real failures may trip the
      // cron scheduler's notifications (ADR-0007).
      status: details.skipped === true ? JOB_RUN_STATUS.SKIPPED : JOB_RUN_STATUS.OK,
      durationMs,
      details,
    };
    return c.json(body, 200);
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    logError("job.failed", { job: jobName, durationMs, error });
    const message = error instanceof Error ? error.message : "Job failed.";
    const body: JobRunResponse = {
      job: jobName,
      status: JOB_RUN_STATUS.ERROR,
      durationMs,
      message,
    };
    return c.json(body, 500);
  }
}
