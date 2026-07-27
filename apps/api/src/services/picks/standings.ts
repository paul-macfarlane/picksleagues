import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, standings, users } from "@picksleagues/db";
import { rankStandings } from "@picksleagues/scoring";
import type { LeagueStandingsResponse, StandingsRow } from "@picksleagues/schemas";
import { getLeagueWithCurrentSeason } from "../leagues/current-season";
import { getMembership } from "../leagues/authz";
import { PICKEM_REFUSAL, type PickemReadRefusal } from "./pickem";
import { getWeek } from "./slate";

/**
 * Reads the standings for a league's current season instance (spec §Game Mode 1
 * — Standings: two parallel leaderboards, weekly and cumulative).
 *
 * Read-only: standings are written exclusively by settlement (arch D10), and a
 * stale board means settlement hasn't run — which is exactly what
 * `lastUpdatedAt` tells the viewer. The spec requires that stamp and forbids
 * claiming real-time freshness.
 */

export type LeagueStandingsResult =
  | { ok: true; value: LeagueStandingsResponse }
  | { ok: false; reason: Extract<PickemReadRefusal, "league_not_found" | "week_out_of_range"> };

export async function getLeagueStandings(
  db: Db,
  leagueId: string,
  userId: string,
  weekId: string | undefined,
): Promise<LeagueStandingsResult> {
  const current = await getLeagueWithCurrentSeason(db, leagueId);
  if (!current) return { ok: false, reason: PICKEM_REFUSAL.LEAGUE_NOT_FOUND };

  const membership = await getMembership(db, leagueId, userId);
  if (!membership) return { ok: false, reason: PICKEM_REFUSAL.LEAGUE_NOT_FOUND };

  if (weekId !== undefined) {
    // Refused rather than answered with an empty board: without this, a week
    // from another season returns the same `{rows: [], lastUpdatedAt: null}` as
    // "this league's week hasn't settled yet", and the caller can't tell the
    // difference. Every other pick surface validates the week this way.
    const week = await getWeek(db, weekId);
    if (!week || week.seasonId !== current.season.seasonId) {
      return { ok: false, reason: PICKEM_REFUSAL.WEEK_OUT_OF_RANGE };
    }
  }

  // Driven from `league_members`, not from `standings`: a member who joined
  // after the last settlement has no row yet, and starting from `standings`
  // would drop them off the board entirely rather than showing the zero the
  // spec promises (§Edge Cases — "a member who joins after Start Week simply
  // has zero-point weeks for weeks already completed"). They appear at zero
  // immediately and get real numbers at the next settlement.
  const rows = await db
    .select({
      leagueMemberId: leagueMembers.id,
      userId: users.id,
      username: users.username,
      displayName: users.display_name,
      image: users.image,
      points: standings.points,
      differential: standings.differential,
      updatedAt: standings.updatedAt,
    })
    .from(leagueMembers)
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .leftJoin(
      standings,
      and(
        eq(standings.leagueMemberId, leagueMembers.id),
        eq(standings.leagueSeasonId, current.season.id),
        weekId === undefined ? isNull(standings.weekId) : eq(standings.weekId, weekId),
      ),
    )
    .where(eq(leagueMembers.leagueId, leagueId))
    // Name order is the tiebreak: `rankStandings` sorts stably, so members
    // level on points AND differential (who share a rank, spec §Tiebreakers)
    // come out alphabetically instead of in whatever order Postgres returned.
    .orderBy(asc(users.display_name));

  const byMemberId = new Map(rows.map((row) => [row.leagueMemberId, row]));

  // Ranked through the same pure function settlement uses, rather than reading
  // the stored `rank` — the 0-filled joiner above has no stored rank, and
  // re-deriving is what keeps their placement consistent with everyone else's
  // instead of inventing a rule this read owns alone.
  const ranked = rankStandings(
    rows.map((row) => ({
      memberId: row.leagueMemberId,
      points: row.points ?? 0,
      differential: row.differential ?? 0,
    })),
  );

  const serialized: StandingsRow[] = ranked.map((entry) => {
    const row = byMemberId.get(entry.memberId);
    return {
      leagueMemberId: entry.memberId,
      userId: row?.userId ?? "",
      username: row?.username ?? null,
      displayName: row?.displayName ?? "",
      image: row?.image ?? null,
      isViewer: row?.userId === userId,
      points: entry.points,
      differential: entry.differential,
      rank: entry.rank,
    };
  });

  // Taken from the rows already selected rather than a second `max()` query: a
  // settlement landing between two statements would stamp the response with a
  // timestamp newer than the rows it returns, which is the exact false
  // freshness claim this field exists to prevent.
  const stamps = rows.map((row) => row.updatedAt).filter((at): at is Date => at !== null);
  const lastUpdatedAt =
    stamps.length === 0
      ? null
      : new Date(Math.max(...stamps.map((at) => at.getTime()))).toISOString();

  return { ok: true, value: { weekId: weekId ?? null, rows: serialized, lastUpdatedAt } };
}
