/**
 * The E2E stack's own environment: a dedicated database and a dedicated
 * SPA/API port pair, so `pnpm test:e2e` never touches the dev database or the
 * dev servers.
 *
 * That isolation is load-bearing, not tidiness. The Pick'em journey resets the
 * simulator with `scope: "environment"`, which deletes **every** league, game,
 * and sport_season it can see (`apps/api/src/services/sim/reset.ts`) — pointed
 * at the dev database, as it was until now, a routine test run destroys
 * whatever leagues someone was hand-testing with.
 *
 * Everything else — secrets, `APP_ENV`, `SIM_ENABLED` — still comes from the
 * root `.env`, so there is no second file of credentials to keep in sync. Node
 * lets the inherited environment win over `--env-file`, which is what lets
 * `playwright.config.ts` hand these overrides to the dev scripts unchanged.
 */

/** Distinct from `pnpm dev`'s 5173/3000 so both stacks can run at once. */
export const E2E_WEB_PORT = 5273;
export const E2E_API_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_WEB_PORT}`;

const E2E_DATABASE_NAME = "picksleagues_e2e";

/**
 * The dev `DATABASE_URL` with its database name swapped — derived rather than
 * hardcoded so it follows the server the rest of the repo already points at
 * (:5433 locally via docker-compose, :5432 for CI's service container) with no
 * extra configuration in either place. `E2E_DATABASE_URL` overrides it outright
 * for anyone who needs to point somewhere else entirely.
 */
export function getE2eDatabaseUrl(devDatabaseUrl: string): string {
  const fromEnv = process.env.E2E_DATABASE_URL;
  if (fromEnv) return fromEnv;

  const url = new URL(devDatabaseUrl);
  url.pathname = `/${E2E_DATABASE_NAME}`;
  return url.toString();
}

/**
 * Loads the root `.env` into `process.env`, then applies the E2E overrides on
 * top — assignment after the load rather than relying on either file's
 * precedence, so which value wins is stated here rather than inferred.
 *
 * Called by the spec-side helpers (they open their own connections to seed and
 * clean up) and by the Playwright global setup. The servers get the same values
 * through `webServer.env`.
 */
export function loadE2eEnv(): { databaseUrl: string } {
  process.loadEnvFile(new URL("../../.env", import.meta.url));

  const devDatabaseUrl = process.env.DATABASE_URL;
  if (!devDatabaseUrl) {
    throw new Error("loadE2eEnv: .env has no DATABASE_URL to derive the E2E database from");
  }

  const databaseUrl = getE2eDatabaseUrl(devDatabaseUrl);
  process.env.DATABASE_URL = databaseUrl;
  // Better Auth rejects a state-changing request whose Origin doesn't match its
  // configured base URL, and the E2E SPA is served from its own port — so this
  // has to move with it. No OAuth app registration is involved: E2E mints
  // sessions directly and never makes the provider hop.
  process.env.BETTER_AUTH_URL = E2E_BASE_URL;

  return { databaseUrl };
}
