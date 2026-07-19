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
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["apps/api/test/**/*.test.ts"],
          globalSetup: ["./apps/api/test/setup/global-setup.ts"],
        },
      },
    ],
  },
});
