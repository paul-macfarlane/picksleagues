import { ensureDatabase } from "../../apps/api/test/setup/ensure-database";
import { loadE2eEnv } from "./e2e-env";

/**
 * Playwright global setup: brings up the E2E database before any spec — and
 * before `webServer` starts the API against it — so a first run on a fresh
 * clone (or after `pnpm db:down`) needs no manual bootstrap step.
 *
 * Same relative-import rationale as ./session.ts: e2e/ declares no
 * dependencies of its own, so this reaches into apps/api's own source tree
 * rather than importing a bare specifier it can't resolve.
 */
export default async function globalSetup(): Promise<void> {
  const { databaseUrl } = loadE2eEnv();
  await ensureDatabase(databaseUrl);
}
