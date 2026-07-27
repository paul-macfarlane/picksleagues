import { sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagueSeasons, leagues, users } from "@picksleagues/db";

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

/**
 * Serializes settlement of one league season. Settlement writes its mode's
 * result and standings tables delete-then-insert (`pickem_pick_results` and
 * `pickem_standings` today), and two concurrent settlers of the same
 * season would each take their snapshot before the other's insert, miss those
 * rows in their DELETE, and then collide on the unique constraints — an
 * aborted transaction and a 500, not corruption, but avoidable. The incremental
 * (`sync-scores`), nightly (`settle-sweep`), admin-rebuild, and `/sim/settle`
 * paths can all overlap, so every one of them takes this first.
 */
export async function lockLeagueSeasonRow(tx: Db, leagueSeasonId: string): Promise<void> {
  await tx.execute(sql`select id from ${leagueSeasons} where id = ${leagueSeasonId} for update`);
}

/**
 * Serializes one member's own pick submissions. The picks-per-week cap is a
 * per-member invariant, so this is the narrowest lock that makes the
 * count-then-insert safe — two concurrent submissions from the same member
 * would otherwise each count the pre-write state and jointly overfill the week.
 * Members don't contend with each other here, unlike the league-wide caps above.
 */
export async function lockLeagueMemberRow(tx: Db, leagueMemberId: string): Promise<void> {
  await tx.execute(sql`select id from ${leagueMembers} where id = ${leagueMemberId} for update`);
}
