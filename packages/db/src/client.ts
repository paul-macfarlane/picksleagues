import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDb>;

/**
 * One pool per process; serverless functions create it at cold start. Plain
 * `pg` works for both local Docker Postgres and Neon.
 */
export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema });
}
