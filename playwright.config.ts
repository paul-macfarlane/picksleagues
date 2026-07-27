import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 5173;
const API_PORT = 3000;

/**
 * Runs against the full local stack per arch D14 (no API mocks). Both dev
 * servers are started (or reused, locally) via `webServer`; Playwright tears
 * down anything it started once the run completes.
 *
 * **Two projects, and the split is load-bearing.** The simulator's clock offset
 * and active scenario live on the environment-wide `app_state` singleton, so a
 * spec that moves simulated time changes what *every* concurrently running spec
 * sees — join cutoffs, lock checks, the lot. Time-independent specs therefore
 * run `fullyParallel` as before, and simulator-driven ones (`*.sim.spec.ts`)
 * run in a separate project that `dependencies` orders strictly after them,
 * with `fullyParallel` off so they never overlap each other either.
 *
 * Two consequences worth knowing before adding one:
 *
 * 1. Keep simulator-driven specs in a single file per journey and
 *    `test.describe.serial` them. Two sim spec *files* could still land on
 *    different workers; the ordering guarantee here is between the projects,
 *    not within one.
 * 2. Playwright **skips** a dependent project when its dependency fails, so any
 *    flake in the parallel suite reports the merge-gate journey as `skipped`
 *    rather than running it. CI still goes red on the flake so the gate holds,
 *    but the journey's own signal is lost for that run — check for `skipped`
 *    before concluding the journey passed. Running a sim spec alone locally
 *    also drags the whole parallel project along first.
 */
const SIM_SPECS = "**/*.sim.spec.ts";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: SIM_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "simulated",
      testMatch: SIM_SPECS,
      fullyParallel: false,
      // Never concurrent with the parallel suite: these specs move the shared
      // simulated clock, and anything reading it mid-flight would see a time
      // it never asked for.
      dependencies: ["chromium"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @picksleagues/api dev",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @picksleagues/web dev",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
