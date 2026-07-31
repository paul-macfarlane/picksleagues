import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const migrationsFolder = new URL("../../../../packages/db/migrations", import.meta.url).pathname;

/**
 * Creates the database named in `databaseUrl` if it doesn't exist yet, then
 * applies the committed drizzle migrations. Idempotent, so reruns are safe and
 * a create-database race against a concurrent run is absorbed (engineering
 * rules §Jobs are idempotent, applied here to test setup).
 *
 * Shared by both harnesses that own a database of their own: the integration
 * suite's vitest global setup (`picksleagues_test`) and the E2E suite's
 * Playwright global setup (`picksleagues_e2e`). One definition because the
 * second one existing at all is what keeps `pnpm test:e2e` off the dev
 * database — a copy that drifted would quietly reintroduce that.
 */
export async function ensureDatabase(databaseUrl: string): Promise<void> {
  const dbName = new URL(databaseUrl).pathname.replace(/^\//, "");

  const maintenanceUrl = new URL(databaseUrl);
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
      // comes from our own env config, never external input.
      try {
        await maintenanceClient.query(`CREATE DATABASE "${dbName}"`);
      } catch (error) {
        // 42P04 duplicate_database: a concurrent run won the check-then-act
        // race — the database exists, which is all we need.
        if (!(error instanceof pg.DatabaseError && error.code === "42P04")) {
          throw error;
        }
      }
    }
  } finally {
    await maintenanceClient.end();
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
