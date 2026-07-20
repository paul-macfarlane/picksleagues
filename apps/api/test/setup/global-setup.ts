import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTestDatabaseUrl } from "./test-database-url";

const migrationsFolder = new URL("../../../../packages/db/migrations", import.meta.url).pathname;

/**
 * Runs once before the `integration` project's test files (vitest global
 * setup). Creates the test database against the server's maintenance
 * `postgres` DB if it doesn't exist yet, then applies the committed drizzle
 * migrations — idempotent, so reruns are safe, and the create-database race
 * against a concurrent run is absorbed below (engineering rules §Jobs are
 * idempotent, applied here to test setup).
 */
export default async function setup(): Promise<void> {
  const testDatabaseUrl = getTestDatabaseUrl();
  const url = new URL(testDatabaseUrl);
  const dbName = url.pathname.replace(/^\//, "");

  const maintenanceUrl = new URL(testDatabaseUrl);
  maintenanceUrl.pathname = "/postgres";

  const maintenanceClient = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await maintenanceClient.connect();
  try {
    const { rowCount } = await maintenanceClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (rowCount === 0) {
      // CREATE DATABASE can't be parameterized or run in a transaction; dbName
      // comes from our own env config (TEST_DATABASE_URL), never external input.
      try {
        await maintenanceClient.query(`CREATE DATABASE "${dbName}"`);
      } catch (error) {
        // 42P04 duplicate_database: a concurrent run won the check-then-act race —
        // the database exists, which is all we need.
        if (!(error instanceof pg.DatabaseError && error.code === "42P04")) {
          throw error;
        }
      }
    }
  } finally {
    await maintenanceClient.end();
  }

  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
