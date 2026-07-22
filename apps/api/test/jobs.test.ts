import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { type Env } from "@picksleagues/core";
import { JobRunResponseSchema, type JobRunResponse } from "@picksleagues/schemas";
import { runJob } from "../src/lib/job-runner";
import { jobSecretMiddleware } from "../src/middleware/job-secret";
import { createApp } from "../src/app";
import { getTestDatabaseUrl } from "./setup/test-database-url";

// Matches packages/core's Env shape without going through loadEnv (which
// caches process-wide) — mirrors test/me.test.ts's testEnv.
const testEnv: Env = {
  APP_ENV: "local",
  DATABASE_URL: getTestDatabaseUrl(),
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-id",
  DISCORD_CLIENT_SECRET: "discord-secret",
  JOB_SECRET: "b".repeat(32),
  ADMIN_USER_IDS: [],
};

/**
 * No concrete `/api/jobs/*` route exists yet (DATA-4/5/6 add the first
 * ones) — this dummy app registers a job the same way a real one will:
 * `jobSecretMiddleware` guarding the router, `runJob` carrying the envelope
 * convention. Exercises the shared conventions in isolation from any real
 * job's business logic.
 */
function buildDummyJobApp() {
  const app = new OpenAPIHono();

  app.use("/jobs/*", jobSecretMiddleware(testEnv.JOB_SECRET));

  const succeedRoute = createRoute({
    method: "post",
    path: "/jobs/dummy-succeed",
    operationId: "dummySucceed",
    responses: {
      200: {
        description: "ok",
        content: { "application/json": { schema: JobRunResponseSchema } },
      },
      500: {
        description: "error",
        content: { "application/json": { schema: JobRunResponseSchema } },
      },
    },
  });

  const failRoute = createRoute({
    method: "post",
    path: "/jobs/dummy-fail",
    operationId: "dummyFail",
    responses: {
      200: {
        description: "ok",
        content: { "application/json": { schema: JobRunResponseSchema } },
      },
      500: {
        description: "error",
        content: { "application/json": { schema: JobRunResponseSchema } },
      },
    },
  });

  app.openapi(succeedRoute, (c) =>
    runJob(c, "dummy-succeed", async () => ({ rowsUpserted: 3, ok: true })),
  );

  app.openapi(failRoute, (c) =>
    runJob(c, "dummy-fail", async () => {
      throw new Error("boom");
    }),
  );

  return app;
}

const dummyApp = buildDummyJobApp();

function postDummy(path: string, headers: Record<string, string> = {}) {
  return dummyApp.request(path, { method: "POST", headers });
}

describe("jobSecretMiddleware + runJob conventions", () => {
  it("401s with no x-job-secret header", async () => {
    const res = await postDummy("/jobs/dummy-succeed");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("401s with a wrong x-job-secret header", async () => {
    const res = await postDummy("/jobs/dummy-succeed", { "x-job-secret": "wrong" });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("200s with the exact JobRunResponse envelope on success", async () => {
    const res = await postDummy("/jobs/dummy-succeed", { "x-job-secret": testEnv.JOB_SECRET });

    expect(res.status).toBe(200);
    const body = (await res.json()) as JobRunResponse;
    expect(body.job).toBe("dummy-succeed");
    expect(body.status).toBe("ok");
    expect(typeof body.durationMs).toBe("number");
    expect(body.details).toEqual({ rowsUpserted: 3, ok: true });
  });

  it("500s with an error envelope and message on failure", async () => {
    const res = await postDummy("/jobs/dummy-fail", { "x-job-secret": testEnv.JOB_SECRET });

    expect(res.status).toBe(500);
    const body = (await res.json()) as JobRunResponse;
    expect(body.job).toBe("dummy-fail");
    expect(body.status).toBe("error");
    expect(typeof body.durationMs).toBe("number");
    expect(body.message).toBe("boom");
  });
});

describe("app-level wiring", () => {
  it("401s a request under /api/jobs/* with no header, proving the guard is mounted", async () => {
    const app = createApp({ env: testEnv });

    const res = await app.request("/api/jobs/anything", { method: "POST" });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });
});
