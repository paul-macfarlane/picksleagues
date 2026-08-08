import { and, asc, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, survivorPicks, survivorState, weeks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  SURVIVOR_PICK_STATUS,
  WEEK_TYPE,
  nflSeasonOrdinal,
  type SurvivorPickStatus,
  type SurvivorSettings,
  type WeekType,
} from "@picksleagues/schemas";
import { resolveGameOverrides } from "../games";
import { resolveCurrentWeekId } from "../league-weeks";
import { isLocked, isPickable } from "../slate";

/**
 * The dashboard's one-line answer to "do I owe a pick here?" for every Survivor
 * league a member is in (spec §Screens — Dashboard).
 *
 * Batched across leagues rather than resolved per card: this sits on the
 * dashboard's critical path and a member can be in many leagues, so it costs
 * four queries whatever that count is.
 *
 * Two rules the module exists to keep server-side:
 * - **Lock is derived, never stored** (arch D11) — computed from each game's
 *   effective kickoff against the injected Clock. Deliberately not computed in
 *   the browser: under the simulator the browser sits at a different instant
 *   from the API, so a browser-derived lock would contradict the very states
 *   every other surface computed.
 * - **The current week has one definition** — `resolveCurrentWeekId`, the same
 *   one the league week list answers with, so the dashboard cannot point a
 *   member at a different week than the pick screen does.
 */

export interface SurvivorPickStatusInput {
  leagueSeasonId: string;
  seasonId: string;
  membershipId: string;
  settings: SurvivorSettings;
}

/**
 * Survivor is regular-season only (spec §Game Mode 2 — Core Rules), so the week
 * type is checked in its own right rather than left to the ordinal comparison —
 * the same shape `isWeekInRange` applies on the pick paths, which is what stops
 * this pointing a member at a week those paths would refuse.
 */
function isInSurvivorRange(
  week: { weekType: WeekType; weekNumber: number },
  settings: SurvivorSettings,
): boolean {
  if (week.weekType !== WEEK_TYPE.REGULAR) return false;
  const ordinal = nflSeasonOrdinal({ type: WEEK_TYPE.REGULAR, number: week.weekNumber });
  return (
    ordinal >= nflSeasonOrdinal(settings.startWeek) && ordinal <= nflSeasonOrdinal(settings.endWeek)
  );
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
  const seasonIds = [...new Set(leagues.map((league) => league.seasonId))];

  // Ordered by start instant like the week list, with the week number as a
  // tiebreak so the "last played" fallback below lands on the same row twice.
  const weekRows = await db
    .select({
      id: weeks.id,
      seasonId: weeks.seasonId,
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
      startsAt: weeks.startsAt,
      endsAt: weeks.endsAt,
    })
    .from(weeks)
    .where(inArray(weeks.seasonId, seasonIds))
    .orderBy(asc(weeks.startsAt), asc(weeks.weekNumber));

  const weeksBySeason = new Map<string, typeof weekRows>();
  for (const row of weekRows) {
    const bucket = weeksBySeason.get(row.seasonId);
    if (bucket) bucket.push(row);
    else weeksBySeason.set(row.seasonId, [row]);
  }

  // The range clip is per league, not per season: two leagues can share a
  // season and configure different ranges over it.
  const currentWeekByLeague = new Map<string, string>();
  for (const league of leagues) {
    const inRange = (weeksBySeason.get(league.seasonId) ?? []).filter((row) =>
      isInSurvivorRange(row, league.settings),
    );
    const weekId = resolveCurrentWeekId(inRange, clock);
    if (weekId) currentWeekByLeague.set(league.leagueSeasonId, weekId);
  }

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

  const currentWeekIds = [...new Set(currentWeekByLeague.values())];

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

  const gameRows =
    currentWeekIds.length === 0
      ? []
      : await db.select().from(games).where(inArray(games.weekId, currentWeekIds));

  const now = clock.now();
  const weeksWithGames = new Set<string>();
  const weeksStillOpen = new Set<string>();
  for (const row of gameRows) {
    weeksWithGames.add(row.weekId);
    const effective = resolveGameOverrides(row);
    if (isPickable(effective.status) && !isLocked(effective.kickoffAt, now)) {
      weeksStillOpen.add(row.weekId);
    }
  }

  for (const league of leagues) {
    const key = memberKey(league.leagueSeasonId, league.membershipId);
    if (eliminated.has(key)) {
      statuses.set(league.leagueSeasonId, SURVIVOR_PICK_STATUS.ELIMINATED);
      continue;
    }

    const weekId = currentWeekByLeague.get(league.leagueSeasonId);
    if (!weekId) continue;

    if (picked.has(`${key}:${weekId}`)) {
      statuses.set(league.leagueSeasonId, SURVIVOR_PICK_STATUS.PICK_IN);
      continue;
    }

    // A week whose schedule hasn't been ingested has closed against nobody —
    // settlement's prefix refuses to grade a week holding no games (ADR-0025),
    // so reporting a miss there would name an elimination that cannot happen.
    const open = weeksStillOpen.has(weekId) || !weeksWithGames.has(weekId);
    statuses.set(
      league.leagueSeasonId,
      open ? SURVIVOR_PICK_STATUS.PICK_NEEDED : SURVIVOR_PICK_STATUS.LOCKED,
    );
  }

  return statuses;
}
