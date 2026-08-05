import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, pickemStandings, users } from "@picksleagues/db";
import { rankStandings } from "@picksleagues/scoring";
import {
  LEAGUE_MODE,
  type PickemStandingsResponse,
  type PickemStandingsRow,
} from "@picksleagues/schemas";
import { getLeagueWithCurrentSeason } from "../leagues/current-season";
import { getMembership } from "../leagues/authz";
import { getWeek } from "../slate";
import { PICKEM_REFUSAL, type PickemReadRefusal } from "./picks";

/**
 * Reads the standings for a league's current season instance (spec §Game Mode 1
 * — Standings: two parallel leaderboards, weekly and cumulative).
 *
 * Read-only: standings are written exclusively by settlement (arch D10), and a
 * stale board means settlement hasn't run — which is exactly what
 * `lastUpdatedAt` tells the viewer. The spec requires that stamp and forbids
 * claiming real-time freshness.
 */

export type PickemStandingsResult =
  { ok: true; value: PickemStandingsResponse } | { ok: false; reason: PickemReadRefusal };

export async function getPickemStandings(
  db: Db,
  leagueId: string,
  userId: string,
  weekId: string | undefined,
): Promise<PickemStandingsResult> {
  const current = await getLeagueWithCurrentSeason(db, leagueId);
  if (!current) return { ok: false, reason: PICKEM_REFUSAL.LEAGUE_NOT_FOUND };

  const membership = await getMembership(db, leagueId, userId);
  if (!membership) return { ok: false, reason: PICKEM_REFUSAL.LEAGUE_NOT_FOUND };

  // Matches every sibling under /pickem/ (loadContext in picks.ts,
  // getPickemPickSummary): a non-Pick'em league must refuse rather than
  // serve a zero-filled board, and the check runs after league-not-found so
  // a private league's existence is never revealed.
  if (current.league.mode !== LEAGUE_MODE.PICKEM) {
    return { ok: false, reason: PICKEM_REFUSAL.WRONG_LEAGUE_MODE };
  }

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

  // Driven from `league_members`, not from `pickem_standings`: a member who
  // joined after the last settlement has no row yet, and starting from
  // `pickem_standings` would drop them off the board entirely rather than
  // showing the zero the spec promises (§Edge Cases — "a member who joins after
  // Start Week simply has zero-point weeks for weeks already completed"). They
  // appear at zero immediately and get real numbers at the next settlement.
  const rows = await db
    .select({
      leagueMemberId: leagueMembers.id,
      userId: users.id,
      username: users.username,
      displayName: users.display_name,
      image: users.image,
      points: pickemStandings.points,
      wins: pickemStandings.wins,
      losses: pickemStandings.losses,
      pushes: pickemStandings.pushes,
      updatedAt: pickemStandings.updatedAt,
    })
    .from(leagueMembers)
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .leftJoin(
      pickemStandings,
      and(
        eq(pickemStandings.leagueMemberId, leagueMembers.id),
        eq(pickemStandings.leagueSeasonId, current.season.id),
        weekId === undefined ? isNull(pickemStandings.weekId) : eq(pickemStandings.weekId, weekId),
      ),
    )
    .where(eq(leagueMembers.leagueId, leagueId))
    // Name order is the display order within a shared rank: `rankStandings`
    // sorts stably, so members level on points (who share a rank, spec
    // §Standings — Ties) come out alphabetically instead of in whatever order
    // Postgres returned.
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
      // Same zero-fill as points: the left join misses for a member with no
      // settled row, and their record is genuinely 0-0-0 rather than unknown.
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
      pushes: row.pushes ?? 0,
    })),
  );

  const serialized: PickemStandingsRow[] = ranked.map((entry) => {
    const row = byMemberId.get(entry.memberId);
    return {
      leagueMemberId: entry.memberId,
      userId: row?.userId ?? "",
      username: row?.username ?? null,
      displayName: row?.displayName ?? "",
      image: row?.image ?? null,
      isViewer: row?.userId === userId,
      points: entry.points,
      wins: entry.wins,
      losses: entry.losses,
      pushes: entry.pushes,
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
