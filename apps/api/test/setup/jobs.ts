import type { createApp } from "../../src/app";
import { makeTestEnv } from "./test-env";

type App = ReturnType<typeof createApp>;

export const TEST_JOB_SECRET = makeTestEnv().JOB_SECRET;

/**
 * The secret-bearing POSTs to the three NFL sync jobs, in a module that opens
 * no pool: the sync-job suites build their own app and must not inherit
 * `sim-helpers`' shared `db` just to borrow a request helper.
 */
export function runScheduleSyncJob(app: App, query = "") {
  return app.request(`/api/jobs/nfl/sync-schedule${query}`, {
    method: "POST",
    headers: { "x-job-secret": TEST_JOB_SECRET },
  });
}

export function runScoresSyncJob(app: App, query = "") {
  return app.request(`/api/jobs/nfl/sync-scores${query}`, {
    method: "POST",
    headers: { "x-job-secret": TEST_JOB_SECRET },
  });
}

export function runOddsSyncJob(app: App, query = "") {
  return app.request(`/api/jobs/nfl/sync-odds${query}`, {
    method: "POST",
    headers: { "x-job-secret": TEST_JOB_SECRET },
  });
}
