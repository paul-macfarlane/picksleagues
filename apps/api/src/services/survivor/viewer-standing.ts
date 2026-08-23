import { inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, survivorState } from "@picksleagues/db";
import { SURVIVOR_MEMBER_STATUS, type SurvivorViewerStanding } from "@picksleagues/schemas";
import { resolveSurvivorSeasonStates, type SurvivorSeasonStateInput } from "./season";

/**
 * Where the viewer stands in every Survivor league they are in, batched for the
 * dashboard the way the pick-status glance is. The mode has no rank (ADR-0016),
 * so the standing is the board's own question — still in, and how many are —
 * and "won" is asked of the season state that owns the rule (ADR-0027) rather
 * than re-derived from a decided flag and this member's elimination.
 */

export interface SurvivorViewerStandingInput extends SurvivorSeasonStateInput {
  membershipId: string;
}

/** Keyed by `leagueSeasonId`; every input whose membership is on the league's roster is present. */
export async function resolveSurvivorViewerStandings(
  db: Db,
  inputs: readonly SurvivorViewerStandingInput[],
): Promise<Map<string, SurvivorViewerStanding>> {
  const standings = new Map<string, SurvivorViewerStanding>();
  if (inputs.length === 0) return standings;

  const memberRows = await db
    .select({ id: leagueMembers.id, leagueId: leagueMembers.leagueId })
    .from(leagueMembers)
    .where(inArray(leagueMembers.leagueId, [...new Set(inputs.map((input) => input.leagueId))]));
  const membersByLeague = new Map<string, Set<string>>();
  for (const row of memberRows) {
    const bucket = membersByLeague.get(row.leagueId);
    if (bucket) bucket.add(row.id);
    else membersByLeague.set(row.leagueId, new Set([row.id]));
  }

  // No row means alive — the ledger is settlement's output alone (arch D10),
  // so elimination is the presence of a busted week, never the absence of one.
  const stateRows = await db
    .select({
      leagueSeasonId: survivorState.leagueSeasonId,
      leagueMemberId: survivorState.leagueMemberId,
      eliminatedWeekId: survivorState.eliminatedWeekId,
    })
    .from(survivorState)
    .where(
      inArray(
        survivorState.leagueSeasonId,
        inputs.map((input) => input.leagueSeasonId),
      ),
    );
  const eliminatedBySeason = new Map<string, Set<string>>();
  for (const row of stateRows) {
    if (row.eliminatedWeekId === null) continue;
    const bucket = eliminatedBySeason.get(row.leagueSeasonId);
    if (bucket) bucket.add(row.leagueMemberId);
    else eliminatedBySeason.set(row.leagueSeasonId, new Set([row.leagueMemberId]));
  }

  const seasonStates = await resolveSurvivorSeasonStates(db, inputs);

  for (const input of inputs) {
    const members = membersByLeague.get(input.leagueId);
    if (!members?.has(input.membershipId)) continue;
    const eliminated = eliminatedBySeason.get(input.leagueSeasonId) ?? new Set<string>();
    // Counted over the roster rather than over the ledger: a member eliminated
    // and since departed has no membership, and the board counts who is left
    // in the league, not who was ever graded.
    let aliveCount = 0;
    for (const memberId of members) if (!eliminated.has(memberId)) aliveCount += 1;
    standings.set(input.leagueSeasonId, {
      status: eliminated.has(input.membershipId)
        ? SURVIVOR_MEMBER_STATUS.ELIMINATED
        : SURVIVOR_MEMBER_STATUS.ALIVE,
      isWinner:
        seasonStates.get(input.leagueSeasonId)?.winnerMemberIds.has(input.membershipId) === true,
      aliveCount,
    });
  }

  return standings;
}
