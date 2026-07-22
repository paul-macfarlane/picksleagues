import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

/**
 * The database supertype services take as their first param. Deliberately the
 * bare drizzle type, not `ReturnType<typeof createDb>` (which intersects
 * `{ $client: Pool }`): a `tx` inside `db.transaction()` must satisfy `Db` so
 * shared query functions compose into transactions (engineering rules
 * §Architecture). Call sites that need the pool (test teardown) keep it —
 * `createDb`'s return type is unchanged.
 */
export type Db = NodePgDatabase<typeof schema>;

/**
 * One pool per process; serverless functions create it at cold start. Plain
 * `pg` works for both local Docker Postgres and Neon.
 */
export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema });
}
