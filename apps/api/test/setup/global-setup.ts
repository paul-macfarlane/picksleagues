import { ensureDatabase } from "./ensure-database";
import { getTestDatabaseUrl } from "./test-database-url";

/**
 * Runs once before the `integration` project's test files (vitest global
 * setup): brings up the integration database, separate from both the dev
 * database and the E2E one.
 */
export default async function setup(): Promise<void> {
  await ensureDatabase(getTestDatabaseUrl());
}
