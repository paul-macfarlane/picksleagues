import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-job failure streaks for repeated-failure alerting (arch §External Data —
 * ingestion jobs alert on repeated failure). `consecutiveFailures` is reset to
 * 0 on any successful run, so an alert fires once per streak (see job-runner
 * wiring). Timestamps are supplied by app code from the injected Clock (arch
 * D13) — no `.defaultNow()`; the integer `default(0)` is a static default, not
 * a time read, so it's permitted.
 */
export const jobHealth = pgTable("job_health", {
  jobName: text("job_name").primaryKey(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
});
