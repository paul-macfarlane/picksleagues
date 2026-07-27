import { and, count, desc, eq, ilike, inArray, notExists } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagues } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import { LEAGUE_STATUS, LEAGUE_VISIBILITY, type DiscoveryLeague } from "@picksleagues/schemas";
import { currentLeagueSeason, isPreStart, leagueStartAt } from "./leagues";

/** Escapes ILIKE's own wildcards so a user's `%`/`_` matches literally, not as a pattern. */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/**
 * spec §Public Discovery: public, active leagues that haven't passed their
 * join cutoff, aren't already full, and the caller isn't already a member of
 * — optionally name-filtered. No filters/categories/recommendations beyond
 * that.
 */
export async function discoverLeagues(
  db: Db,
  clock: Clock,
  userId: string,
  query?: string,
): Promise<DiscoveryLeague[]> {
  const current = currentLeagueSeason(db);
  const conditions = [
    eq(leagues.visibility, LEAGUE_VISIBILITY.PUBLIC),
    // Status is per-season now (ADR-0009) — filter the current instance's.
    eq(current.status, LEAGUE_STATUS.ACTIVE),
    // Excludes leagues the caller already belongs to — joining is pointless
    // and the join endpoints would 409 anyway.
    notExists(
      db
        .select()
        .from(leagueMembers)
        .where(and(eq(leagueMembers.leagueId, leagues.id), eq(leagueMembers.userId, userId))),
    ),
  ];
  if (query) {
    conditions.push(ilike(leagues.name, `%${escapeLikePattern(query)}%`));
  }

  const rows = await db
    .select({
      league: leagues,
      settings: current.settings,
      seasonId: current.seasonId,
      seasonYear: current.seasonYear,
    })
    .from(leagues)
    .innerJoin(current, and(eq(current.leagueId, leagues.id), eq(current.rank, 1)))
    .where(and(...conditions))
    .orderBy(desc(leagues.createdAt));
  if (rows.length === 0) return [];

  const counts = await db
    .select({ leagueId: leagueMembers.leagueId, value: count() })
    .from(leagueMembers)
    .where(
      inArray(
        leagueMembers.leagueId,
        rows.map((r) => r.league.id),
      ),
    )
    .groupBy(leagueMembers.leagueId);
  const countByLeague = new Map(counts.map((c) => [c.leagueId, c.value]));

  // One start-derivation query per candidate league: fine at this scale (a
  // public browse list), and correctness (override-aware, per-mode) beats a
  // hand-rolled batch join — same tradeoff as listMyLeagues.
  const withStarts = await Promise.all(
    rows.map(async (row) => ({
      row,
      startsAt: await leagueStartAt(
        db,
        { mode: row.league.mode, seasonId: row.seasonId },
        row.settings,
      ),
    })),
  );

  return withStarts
    .filter(({ row, startsAt }) => {
      const memberCount = countByLeague.get(row.league.id) ?? 0;
      return isPreStart(startsAt, clock) && memberCount < row.league.maxMembers;
    })
    .map(({ row, startsAt }) => ({
      id: row.league.id,
      name: row.league.name,
      mode: row.league.mode,
      memberCount: countByLeague.get(row.league.id) ?? 0,
      seasonYear: row.seasonYear,
      startsAt: startsAt ? startsAt.toISOString() : null,
    }));
}
