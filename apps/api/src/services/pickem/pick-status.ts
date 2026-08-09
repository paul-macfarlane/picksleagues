import { and, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { pickemPicks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  isWeekInSeasonRange,
  LEAGUE_STATUS,
  PICKEM_PICK_STATUS,
  type LeagueStatus,
  type PickemPickStatus,
  type PickemSettings,
} from "@picksleagues/schemas";
import { resolveLeagueWeekFrames } from "../league-weeks";

/**
 * The dashboard's one-line answer to "do I owe picks here?" for every Pick'em
 * league a member is in (spec §Screens — Dashboard).
 *
 * Which week that is and whether it is still open comes from
 * `resolveLeagueWeekFrames`, shared with Survivor's glance — the derived-lock
 * and one-definition-of-the-current-week rules it keeps are stated there. What
 * is Pick'em's own is what a week means: **one atomic, immutable submission**
 * (ADR-0018), so holding any pick for the week is the whole of "submitted" and
 * there is no partial state for this to name.
 */

export interface PickemPickStatusInput {
  leagueSeasonId: string;
  seasonId: string;
  membershipId: string;
  settings: PickemSettings;
  status: LeagueStatus;
}

/**
 * Keyed by `leagueSeasonId`. A league whose season holds no in-range week is
 * absent rather than mapped to a state, unless its season has already ended:
 * with no week there is nothing to owe, and inventing one would announce a miss
 * the schedule never made possible.
 */
export async function resolvePickemPickStatuses(
  db: Db,
  clock: Clock,
  leagues: readonly PickemPickStatusInput[],
): Promise<Map<string, PickemPickStatus>> {
  const statuses = new Map<string, PickemPickStatus>();
  if (leagues.length === 0) return statuses;

  const frames = await resolveLeagueWeekFrames(
    db,
    clock,
    leagues.map((league) => ({
      leagueSeasonId: league.leagueSeasonId,
      seasonId: league.seasonId,
      playsWeek: (week) => isWeekInSeasonRange(week, league.settings),
    })),
  );

  const currentWeekIds = [...new Set([...frames.values()].map((frame) => frame.weekId))];

  const picks =
    currentWeekIds.length === 0
      ? []
      : await db
          .select({
            leagueSeasonId: pickemPicks.leagueSeasonId,
            leagueMemberId: pickemPicks.leagueMemberId,
            weekId: pickemPicks.weekId,
          })
          .from(pickemPicks)
          .where(
            and(
              inArray(
                pickemPicks.leagueSeasonId,
                leagues.map((league) => league.leagueSeasonId),
              ),
              inArray(
                pickemPicks.leagueMemberId,
                leagues.map((league) => league.membershipId),
              ),
              inArray(pickemPicks.weekId, currentWeekIds),
            ),
          );
  const submitted = new Set(
    picks.map((row) => `${row.leagueSeasonId}:${row.leagueMemberId}:${row.weekId}`),
  );

  for (const league of leagues) {
    // Asked before the week, because it is a fact about the season rather than
    // about a week the member owes: the current-week resolution falls back to
    // the last week played, so a finished league would otherwise report that
    // week's state forever. Settlement's stored ending is the source (ADR-0030)
    // — the same one the pick endpoint refuses writes on — rather than a second
    // walk of the schedule that could disagree with it.
    if (league.status === LEAGUE_STATUS.CONCLUDED) {
      statuses.set(league.leagueSeasonId, PICKEM_PICK_STATUS.SEASON_COMPLETE);
      continue;
    }

    const frame = frames.get(league.leagueSeasonId);
    if (!frame) continue;

    if (submitted.has(`${league.leagueSeasonId}:${league.membershipId}:${frame.weekId}`)) {
      statuses.set(league.leagueSeasonId, PICKEM_PICK_STATUS.PICKS_IN);
      continue;
    }

    // Exactly the pick screen's own test — it heads a week with no pickable
    // game "This week is closed" — so the card and the screen behind it cannot
    // disagree. That makes a week whose games haven't been ingested closed here,
    // deliberately unlike Survivor, where an ungraded week must not announce a
    // miss (ADR-0025): Pick'em has no miss penalty, and a "Picks needed" prompt
    // leading to a screen with nothing to pick is the worse answer.
    //
    // `open` is not "a full set can be submitted right now": a member arriving
    // mid-week submits a smaller set of what is left (`requiredPickemPickCount`),
    // and an ATS week whose lines haven't landed is waiting on the odds sync —
    // which is what its own pick screen says too, rather than calling it closed.
    statuses.set(
      league.leagueSeasonId,
      frame.open ? PICKEM_PICK_STATUS.PICKS_NEEDED : PICKEM_PICK_STATUS.LOCKED,
    );
  }

  return statuses;
}
