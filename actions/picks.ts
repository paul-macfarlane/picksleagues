"use server";

import { revalidatePath } from "next/cache";

import {
  getEventsByPhaseWithTeams,
  getOddsForEventsWithSportsbook,
  indexPrimaryOddsByEvent,
} from "@/data/events";
import { getLeagueById } from "@/data/leagues";
import { getPhaseById } from "@/data/phases";
import { deleteUserPicksForEvents, insertPicks } from "@/data/picks";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { withTransaction } from "@/data/utils";
import { getSession } from "@/lib/auth";
import type { NewPick } from "@/lib/db/schema/picks";
import {
  isPhaseInLeagueRange,
  isPhaseLocked,
  selectCurrentSeason,
} from "@/lib/nfl/leagues";
import { assertLeagueMember } from "@/lib/permissions";
import { getAppNow } from "@/lib/simulator";
import type { ActionResult } from "@/lib/types";
import { submitPicksSchema } from "@/lib/validators/picks";

export async function submitPicksAction(input: unknown): Promise<ActionResult> {
  const parsed = submitPicksSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid picks.",
    };
  }

  const session = await getSession();
  const { leagueId, phaseId, picks: selections } = parsed.data;

  await assertLeagueMember(session.user.id, leagueId);

  const league = await getLeagueById(leagueId);
  if (!league) {
    return { success: false, error: "League not found." };
  }

  const phase = await getPhaseById(phaseId);
  if (!phase) {
    return { success: false, error: "Phase not found." };
  }
  if (!isPhaseInLeagueRange(phase, league)) {
    return {
      success: false,
      error: "That phase isn't part of this league's schedule.",
    };
  }

  const now = await getAppNow();

  // §7.1 #2: picks can only be submitted for the current phase. The phase
  // must belong to the league's sport AND to the current season (not a
  // prior year's "Week 3" whose tuple also matches the league's range).
  const seasons = await getSeasonsBySportsLeague(league.sportsLeagueId);
  const currentSeason = selectCurrentSeason(seasons, now);
  if (!currentSeason || phase.seasonId !== currentSeason.id) {
    return {
      success: false,
      error: "That phase isn't in the current season.",
    };
  }

  if (isPhaseLocked(phase, now)) {
    return { success: false, error: "Picks have locked for this phase." };
  }

  const events = await getEventsByPhaseWithTeams(phase.id);
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const unstartedEvents = events.filter((e) => now < e.startTime);
  const requiredCount = Math.min(league.picksPerPhase, unstartedEvents.length);

  if (requiredCount === 0) {
    return {
      success: false,
      error: "No games left to pick for this phase.",
    };
  }

  if (selections.length !== requiredCount) {
    return {
      success: false,
      error: `You must submit exactly ${requiredCount} pick${requiredCount === 1 ? "" : "s"}.`,
    };
  }

  const seenEventIds = new Set<string>();
  for (const sel of selections) {
    if (seenEventIds.has(sel.eventId)) {
      return { success: false, error: "Each game can only be picked once." };
    }
    seenEventIds.add(sel.eventId);

    const event = eventsById.get(sel.eventId);
    if (!event || event.phaseId !== phase.id) {
      return {
        success: false,
        error: "Pick references a game that isn't in this phase.",
      };
    }
    if (now >= event.startTime) {
      return {
        success: false,
        error: "Can't pick a game that has already started.",
      };
    }
    if (event.homeTeamId !== sel.teamId && event.awayTeamId !== sel.teamId) {
      return {
        success: false,
        error: "Selected team isn't in that game.",
      };
    }
  }

  // For ATS leagues, freeze the current spread at submission time so the
  // pick is scored against what the user saw — §9.3.
  const frozenSpreadByEventId = new Map<string, number>();
  if (league.pickType === "against_the_spread") {
    const oddsByEventId = indexPrimaryOddsByEvent(
      await getOddsForEventsWithSportsbook(selections.map((s) => s.eventId)),
    );
    for (const sel of selections) {
      const odds = oddsByEventId.get(sel.eventId);
      const event = eventsById.get(sel.eventId);
      if (!odds || !event) {
        return {
          success: false,
          error:
            "Spreads aren't available yet for one of the games. Try again in a moment.",
        };
      }
      const spread =
        sel.teamId === event.homeTeamId ? odds.homeSpread : odds.awaySpread;
      if (spread == null) {
        return {
          success: false,
          error:
            "Spreads aren't available yet for one of the games. Try again in a moment.",
        };
      }
      frozenSpreadByEventId.set(sel.eventId, spread);
    }
  }

  // Replace the user's picks on unstarted events for this phase. Picks on
  // games that have already started are preserved automatically — they
  // aren't in `unstartedEvents`, so the delete leaves them untouched.
  const unstartedEventIds = unstartedEvents.map((e) => e.id);
  const picksToInsert: Omit<NewPick, "id" | "createdAt" | "updatedAt">[] =
    selections.map((sel) => ({
      leagueId,
      userId: session.user.id,
      phaseId: phase.id,
      eventId: sel.eventId,
      teamId: sel.teamId,
      spreadAtLock: frozenSpreadByEventId.get(sel.eventId) ?? null,
    }));
  await withTransaction(async (tx) => {
    await deleteUserPicksForEvents(
      leagueId,
      session.user.id,
      unstartedEventIds,
      tx,
    );
    await insertPicks(picksToInsert, tx);
  });

  revalidatePath(`/leagues/${leagueId}/my-picks`);
  revalidatePath(`/leagues/${leagueId}/league-picks`);
  return { success: true, data: undefined };
}
