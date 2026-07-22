import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, jobHealth } from "@picksleagues/db";
import { FixedClock } from "@picksleagues/core";
import { JobRunResponseSchema, type JobRunResponse } from "@picksleagues/schemas";
import { ALERT_AFTER_CONSECUTIVE_FAILURES, runJob } from "../src/lib/job-runner";
import { createDiscordAlerter, type Alerter } from "../src/lib/alerting";
import { getTestDatabaseUrl } from "./setup/test-database-url";

const FIXED_NOW = new Date("2026-09-15T12:00:00.000Z");

const jobRunResponses = {
  200: { description: "ok", content: { "application/json": { schema: JobRunResponseSchema } } },
  500: { description: "error", content: { "application/json": { schema: JobRunResponseSchema } } },
} as const;

const failRoute = createRoute({
  method: "post",
  path: "/jobs/fail",
  operationId: "healthFail",
  responses: jobRunResponses,
});

const succeedRoute = createRoute({
  method: "post",
  path: "/jobs/succeed",
  operationId: "healthSucceed",
  responses: jobRunResponses,
});

const db = createDb(getTestDatabaseUrl());

/** A job app whose fail/succeed routes share one job name (and thus one health row). */
function buildJobApp(jobName: string, alerter: Alerter) {
  const app = new OpenAPIHono();
  const ctx = { db, clock: new FixedClock(FIXED_NOW), alerter };
  app.openapi(failRoute, (c) =>
    runJob(c, jobName, ctx, async () => {
      throw new Error("kaboom");
    }),
  );
  app.openapi(succeedRoute, (c) => runJob(c, jobName, ctx, async () => ({ ran: true })));
  return app;
}

async function healthRow(jobName: string) {
  const [row] = await db.select().from(jobHealth).where(eq(jobHealth.jobName, jobName));
  return row;
}

beforeEach(async () => {
  await db.delete(jobHealth);
});

afterAll(async () => {
  await db.$client.end();
});

describe("runJob health tracking", () => {
  it("alerts once at exactly three failures, resets on success, and re-alerts on a fresh streak", async () => {
    const alerts: Array<{ jobName: string; message: string; consecutiveFailures: number }> = [];
    const alerter: Alerter = async (alert) => {
      alerts.push(alert);
    };
    const app = buildJobApp("streak-job", alerter);

    // Three failures: streak climbs 1 → 2 → 3, alerting exactly on the third.
    for (const expectedStreak of [1, 2, 3]) {
      const res = await app.request("/jobs/fail", { method: "POST" });
      expect(res.status).toBe(500);
      const row = await healthRow("streak-job");
      expect(row?.consecutiveFailures).toBe(expectedStreak);
      expect(row?.lastFailureAt).toEqual(FIXED_NOW);
    }

    expect(ALERT_AFTER_CONSECUTIVE_FAILURES).toBe(3);
    expect(alerts).toEqual([{ jobName: "streak-job", message: "kaboom", consecutiveFailures: 3 }]);
    expect((await healthRow("streak-job"))?.lastAlertedAt).toEqual(FIXED_NOW);

    // A fourth failure keeps climbing but must not fire a second alert.
    await app.request("/jobs/fail", { method: "POST" });
    expect((await healthRow("streak-job"))?.consecutiveFailures).toBe(4);
    expect(alerts).toHaveLength(1);

    // A success resets the streak so a later streak can alert again.
    const okRes = await app.request("/jobs/succeed", { method: "POST" });
    expect(okRes.status).toBe(200);
    const afterSuccess = await healthRow("streak-job");
    expect(afterSuccess?.consecutiveFailures).toBe(0);
    expect(afterSuccess?.lastSuccessAt).toEqual(FIXED_NOW);

    // Three more failures → a second alert fires on the fresh streak.
    for (let i = 0; i < 3; i += 1) {
      await app.request("/jobs/fail", { method: "POST" });
    }
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toEqual({ jobName: "streak-job", message: "kaboom", consecutiveFailures: 3 });
  });

  it("a webhook whose fetch rejects never changes the 500 job envelope", async () => {
    // createDiscordAlerter swallows the rejected fetch (alert.failed) — the job
    // response must be an unchanged 500, and health bookkeeping must complete.
    const rejectingFetch: typeof fetch = async () => {
      throw new Error("network down");
    };
    const alerter = createDiscordAlerter("https://example.com/webhook", rejectingFetch);
    const app = buildJobApp("brittle-webhook-job", alerter);

    let lastBody: JobRunResponse | undefined;
    for (let i = 0; i < 3; i += 1) {
      const res = await app.request("/jobs/fail", { method: "POST" });
      expect(res.status).toBe(500);
      lastBody = (await res.json()) as JobRunResponse;
    }

    expect(lastBody).toMatchObject({ job: "brittle-webhook-job", status: "error", message: "kaboom" });
    const row = await healthRow("brittle-webhook-job");
    expect(row?.consecutiveFailures).toBe(3);
    expect(row?.lastAlertedAt).toEqual(FIXED_NOW);
  });
});
