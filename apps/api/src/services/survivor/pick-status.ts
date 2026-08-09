import { and, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { survivorPicks, survivorState } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  SURVIVOR_PICK_STATUS,
  type LeagueStatus,
  type SurvivorPickStatus,
  type SurvivorSettings,
} from "@picksleagues/schemas";
import { resolveLeagueWeekFrames } from "../league-weeks";
import { isSurvivorRangeWeek, resolveSurvivorSeasonStates } from "./season";

/**
 * The dashboard's one-line answer to "do I owe a pick here?" for every Survivor
 * league a member is in (spec §Screens — Dashboard).
 *
 * Which week that is and whether it is still open comes from
 * `resolveLeagueWeekFrames`, shared with Pick'em's glance — the derived-lock and
 * one-definition-of-the-current-week rules it keeps are stated there. What is
 * Survivor's own is everything below the frame: elimination and winning are
 * facts about the member's *season*, so they outrank every week-shaped state
 * and are answered before a week is even looked up.
 */

/** A superset of `SurvivorSeasonStateInput`, so the batch below passes straight through. */
export interface SurvivorPickStatusInput {
  leagueSeasonId: string;
  leagueId: string;
  seasonId: string;
  membershipId: string;
  settings: SurvivorSettings;
  status: LeagueStatus;
}

function memberKey(leagueSeasonId: string, membershipId: string): string {
  return `${leagueSeasonId}:${membershipId}`;
}

/**
 * Keyed by `leagueSeasonId`. A league whose season holds no in-range week is
 * absent rather than mapped to a state: there is no week to owe a pick for, and
 * inventing one would announce a miss the schedule never made possible.
 * Elimination is the one answer that survives having no week, because it is a
 * fact about the member's season rather than about a week they owe.
 */
export async function resolveSurvivorPickStatuses(
  db: Db,
  clock: Clock,
  leagues: readonly SurvivorPickStatusInput[],
): Promise<Map<string, SurvivorPickStatus>> {
  const statuses = new Map<string, SurvivorPickStatus>();
  if (leagues.length === 0) return statuses;

  const leagueSeasonIds = leagues.map((league) => league.leagueSeasonId);
  const membershipIds = leagues.map((league) => league.membershipId);

  const frames = await resolveLeagueWeekFrames(
    db,
    clock,
    leagues.map((league) => ({
      leagueSeasonId: league.leagueSeasonId,
      seasonId: league.seasonId,
      playsWeek: (week) => isSurvivorRangeWeek(week, league.settings),
    })),
  );

  const state = await db
    .select({
      leagueSeasonId: survivorState.leagueSeasonId,
      leagueMemberId: survivorState.leagueMemberId,
      eliminatedWeekId: survivorState.eliminatedWeekId,
    })
    .from(survivorState)
    .where(
      and(
        inArray(survivorState.leagueSeasonId, leagueSeasonIds),
        inArray(survivorState.leagueMemberId, membershipIds),
      ),
    );
  // No row means alive — nothing mints one at join time, the ledger is
  // settlement's output alone (arch D10).
  const eliminated = new Set(
    state
      .filter((row) => row.eliminatedWeekId !== null)
      .map((row) => memberKey(row.leagueSeasonId, row.leagueMemberId)),
  );

  const currentWeekIds = [...new Set([...frames.values()].map((frame) => frame.weekId))];

  const picks =
    currentWeekIds.length === 0
      ? []
      : await db
          .select({
            leagueSeasonId: survivorPicks.leagueSeasonId,
            leagueMemberId: survivorPicks.leagueMemberId,
            weekId: survivorPicks.weekId,
          })
          .from(survivorPicks)
          .where(
            and(
              inArray(survivorPicks.leagueSeasonId, leagueSeasonIds),
              inArray(survivorPicks.leagueMemberId, membershipIds),
              inArray(survivorPicks.weekId, currentWeekIds),
            ),
          );
  const picked = new Set(
    picks.map((row) => `${memberKey(row.leagueSeasonId, row.leagueMemberId)}:${row.weekId}`),
  );

  const seasonStates = await resolveSurvivorSeasonStates(db, leagues);

  for (const league of leagues) {
    const key = memberKey(league.leagueSeasonId, league.membershipId);
    const season = seasonStates.get(league.leagueSeasonId);

    // Winner membership is the whole of the "won" test, asked of the season
    // state that owns the rule (ADR-0027) rather than re-derived from a decided
    // flag and this member's elimination. Winners are a decided season's alive
    // set, so the two orderings agree; this one states what it means directly.
    //
    // Both answers come before the week lookup because they are facts about the
    // member's season rather than about a week they owe: a league with no
    // current week must still report them.
    if (season?.winnerMemberIds.has(league.membershipId) === true) {
      statuses.set(league.leagueSeasonId, SURVIVOR_PICK_STATUS.WON);
      continue;
    }

    if (eliminated.has(key)) {
      statuses.set(league.leagueSeasonId, SURVIVOR_PICK_STATUS.ELIMINATED);
      continue;
    }

    const frame = frames.get(league.leagueSeasonId);
    if (!frame) continue;

    if (picked.has(`${key}:${frame.weekId}`)) {
      statuses.set(league.leagueSeasonId, SURVIVOR_PICK_STATUS.PICK_IN);
      continue;
    }

    // A week whose schedule hasn't been ingested has closed against nobody —
    // settlement's prefix refuses to grade a week holding no games (ADR-0025),
    // so reporting a miss there would name an elimination that cannot happen.
    // Survivor's own rule, which is why the frame reports the two facts and
    // leaves the judgement here.
    const open = frame.open || !frame.hasGames;
    statuses.set(
      league.leagueSeasonId,
      open ? SURVIVOR_PICK_STATUS.PICK_NEEDED : SURVIVOR_PICK_STATUS.LOCKED,
    );
  }

  return statuses;
}
