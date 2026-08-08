import { defineConfig, devices } from "@playwright/test";
import { E2E_API_PORT, E2E_BASE_URL, E2E_WEB_PORT, loadE2eEnv } from "./e2e/setup/e2e-env";

// Resolved at config load (before `globalSetup`) because `webServer.env` below
// has to carry the same database URL the specs will open connections to.
const { databaseUrl } = loadE2eEnv();

/**
 * Runs against the full local stack per arch D14 (no API mocks). Both dev
 * servers are started via `webServer`; Playwright tears them down once the run
 * completes.
 *
 * **The stack is a parallel one, not the dev stack.** Its own database
 * (`picksleagues_e2e`) and its own ports, because the Pick'em journey resets
 * the simulator with `scope: "environment"` — which deletes every league, game,
 * and season it can reach. Sharing the dev database meant a test run destroyed
 * whatever leagues someone was hand-testing with; sharing the dev *ports* would
 * mean the run either evicted a running `pnpm dev` or silently borrowed it
 * along with its database. `e2e/setup/e2e-env.ts` owns both overrides.
 *
 * **Two projects, and the split is load-bearing.** The simulator's clock offset
 * and active scenario live on the environment-wide `app_state` singleton, so a
 * spec that moves simulated time changes what *every* concurrently running spec
 * sees — join cutoffs, lock checks, the lot. Time-independent specs therefore
 * run `fullyParallel` as before, and simulator-driven ones (`*.sim.spec.ts`)
 * run in a separate project that `dependencies` orders strictly after them,
 * with `fullyParallel` off *and* `workers: 1` so they never overlap each other
 * either. Both are needed and neither is redundant: `fullyParallel: false`
 * stops two tests of one file running side by side, while `workers: 1` stops
 * two sim spec *files* being handed to two workers — which is what happened the
 * first time a second journey was added, and it read as the first journey's
 * fixture mysteriously holding another scenario's games.
 *
 * Two consequences worth knowing before adding one:
 *
 * 1. Keep one journey per file and `test.describe.serial` it. The project runs
 *    files one after another, so a journey split across two files would still
 *    interleave with nothing ordering them.
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
  // Creates and migrates the E2E database before `webServer` starts the API
  // against it, so a fresh clone needs no bootstrap step.
  globalSetup: "./e2e/setup/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // Above Playwright's 5s default because this stack is always cold now: with
  // `reuseExistingServer` off, every run starts its own Vite, and Vite
  // pre-bundles dependencies on first start — enough to push the first
  // data-driven assertion past 5s. CI hid that behind `retries`; locally there
  // are none, and a merge gate that flakes on its first run is one people learn
  // to re-run instead of read. A genuinely broken assertion still fails, later.
  expect: { timeout: 15_000 },
  use: {
    baseURL: E2E_BASE_URL,
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
      // The simulated clock and the active scenario are one environment-wide
      // row, so this project's files share a single resource and must run one
      // at a time — the case `testProject.workers` exists for.
      workers: 1,
      // Never concurrent with the parallel suite: these specs move the shared
      // simulated clock, and anything reading it mid-flight would see a time
      // it never asked for.
      dependencies: ["chromium"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Both servers run the ordinary dev scripts with the E2E environment layered
  // on top: Node lets the inherited environment win over `--env-file`, so these
  // override the root .env's database and ports while every secret in it still
  // applies. `reuseExistingServer` stays off in both — a listener already on an
  // E2E port is a leftover from an earlier run, quite possibly on another
  // branch, and silently testing that instead is worse than failing to bind.
  webServer: [
    {
      command: "pnpm --filter @picksleagues/api dev",
      url: `http://localhost:${E2E_API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_URL: E2E_BASE_URL,
        API_PORT: String(E2E_API_PORT),
      },
    },
    {
      command: "pnpm --filter @picksleagues/web dev",
      url: E2E_BASE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      // Vite proxies /api to the E2E API, keeping the SPA and API same-origin
      // exactly as they are in dev — just on a different pair of ports.
      env: {
        WEB_PORT: String(E2E_WEB_PORT),
        API_PORT: String(E2E_API_PORT),
      },
    },
  ],
});
