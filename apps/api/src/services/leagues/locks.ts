import { sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagues, users } from "@picksleagues/db";

/**
 * Row locks serializing this epic's count-after-write invariant checks (the
 * 10-commissionership cap, the ≥1-commissioner invariant, the 100-member
 * size cap). Under READ COMMITTED, two concurrent transactions can each pass
 * a post-write count and jointly break the rule; taking the same row lock
 * first makes them queue, so the second one's count sees the first's
 * committed writes. Every membership-mutating transaction MUST take the
 * league lock; cap checks (per-user, cross-league) take the user lock.
 */
export async function lockLeagueRow(tx: Db, leagueId: string): Promise<void> {
  await tx.execute(sql`select id from ${leagues} where id = ${leagueId} for update`);
}

export async function lockUserRow(tx: Db, userId: string): Promise<void> {
  await tx.execute(sql`select id from ${users} where id = ${userId} for update`);
}
