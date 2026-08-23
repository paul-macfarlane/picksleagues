import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, pickemStandings } from "@picksleagues/db";
import { rankStandings } from "@picksleagues/scoring";
import type { PickemViewerStanding } from "@picksleagues/schemas";

/**
 * The viewer's own line of the season board for every Pick'em league a member
 * is in, batched for the dashboard the way the pick-status glance is: one
 * members read and one standings read however many leagues the member holds.
 *
 * Ranked through `rankStandings` over the *whole* league rather than read from
 * the stored `rank`, for the reason `getPickemStandings` does the same: a member
 * who joined after the last settlement has no stored row, and their zero line
 * has to place them among everyone else by the one rule settlement uses. It is
 * also what lets `rankShared` be answered — a tie is a fact about the board,
 * not about the row.
 */

export interface PickemViewerStandingInput {
  leagueSeasonId: string;
  leagueId: string;
  membershipId: string;
}

/** Keyed by `leagueSeasonId`; every input whose membership is on the league's roster is present. */
export async function resolvePickemViewerStandings(
  db: Db,
  inputs: readonly PickemViewerStandingInput[],
): Promise<Map<string, PickemViewerStanding>> {
  const standings = new Map<string, PickemViewerStanding>();
  if (inputs.length === 0) return standings;

  // Driven from `league_members`, not `pickem_standings` (see
  // `getPickemStandings`): the left join is what gives an unsettled member a
  // zero line instead of no line. The season filter sits in the join condition
  // so a member with no row for this instance still survives the join.
  const rows = await db
    .select({
      leagueId: leagueMembers.leagueId,
      leagueMemberId: leagueMembers.id,
      points: pickemStandings.points,
      wins: pickemStandings.wins,
      losses: pickemStandings.losses,
      pushes: pickemStandings.pushes,
    })
    .from(leagueMembers)
    .leftJoin(
      pickemStandings,
      and(
        eq(pickemStandings.leagueMemberId, leagueMembers.id),
        inArray(
          pickemStandings.leagueSeasonId,
          inputs.map((input) => input.leagueSeasonId),
        ),
        isNull(pickemStandings.weekId),
      ),
    )
    .where(inArray(leagueMembers.leagueId, [...new Set(inputs.map((input) => input.leagueId))]));

  const rowsByLeague = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = rowsByLeague.get(row.leagueId);
    if (bucket) bucket.push(row);
    else rowsByLeague.set(row.leagueId, [row]);
  }

  for (const input of inputs) {
    const ranked = rankStandings(
      (rowsByLeague.get(input.leagueId) ?? []).map((row) => ({
        memberId: row.leagueMemberId,
        points: row.points ?? 0,
        wins: row.wins ?? 0,
        losses: row.losses ?? 0,
        pushes: row.pushes ?? 0,
      })),
    );
    const mine = ranked.find((entry) => entry.memberId === input.membershipId);
    if (!mine) continue;
    standings.set(input.leagueSeasonId, {
      rank: mine.rank,
      rankShared: ranked.some((entry) => entry.rank === mine.rank && entry !== mine),
      points: mine.points,
      wins: mine.wins,
      losses: mine.losses,
      pushes: mine.pushes,
    });
  }

  return standings;
}
