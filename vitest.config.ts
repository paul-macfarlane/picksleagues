import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Two independent projects (arch §Automated Testing): `unit` never touches a
 * database and must pass with nothing else running; `integration` exercises
 * the Hono app in-process against real Postgres (setup below creates/migrates
 * the test DB). Run with `--project <name>` so each stays independently
 * runnable, per `pnpm test` / `pnpm test:integration`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        // Mirrors apps/web/vite.config.ts so a colocated web unit test can use
        // the same `@/` imports as the module it covers — without it, a web
        // module reachable only through the alias can't be unit-tested at all.
        resolve: {
          alias: { "@": path.resolve(import.meta.dirname, "./apps/web/src") },
        },
        test: {
          name: "unit",
          environment: "node",
          // apps/*/src covers colocated unit tests too (convention: apps/api/test/
          // is integration-only); a test outside these globs silently never runs.
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["apps/api/test/**/*.test.ts"],
          globalSetup: ["./apps/api/test/setup/global-setup.ts"],
          // Every integration file shares the one test Postgres and truncates
          // in beforeEach; running files in parallel workers would let them
          // stomp each other's rows. Serialize files (tests within a file are
          // already sequential).
          fileParallelism: false,
        },
      },
    ],
  },
});
