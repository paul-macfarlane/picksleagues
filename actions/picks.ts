"use server";

import { revalidatePath } from "next/cache";

import {
  getEventsByPhaseWithTeams,
  getOddsForEventsWithSportsbook,
  indexPrimaryOddsByEvent,
} from "@/data/events";
import { getLeagueById } from "@/data/leagues";
import { getPhasesBySeason } from "@/data/phases";
import {
  deleteUserPicksForEvents,
  getPicksForLeaguePhase,
  insertPicks,
} from "@/data/picks";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { withTransaction } from "@/data/utils";
import { getSession } from "@/lib/auth";
import type { NewPick } from "@/lib/db/schema/picks";
import {
  hasEventStarted,
  isPhaseInLeagueRange,
  isPhaseLocked,
  selectCurrentSeason,
  selectLeagueCurrentPhase,
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

  const now = await getAppNow();

  const seasons = await getSeasonsBySportsLeague(league.sportsLeagueId);
  const currentSeason = selectCurrentSeason(seasons, now);
  if (!currentSeason) {
    return { success: false, error: "No active season for this league." };
  }

  // §7.1 #2: picks can only be submitted for the current phase — the phase
  // that §6.3 resolves given "now" and the league's range. Future and past
  // phases in the range are view-only.
  const seasonPhases = await getPhasesBySeason(currentSeason.id);
  const currentPhase = selectLeagueCurrentPhase(seasonPhases, league, now);
  if (!currentPhase || currentPhase.id !== phaseId) {
    return {
      success: false,
      error: "You can only submit picks for the current week.",
    };
  }
  const phase = currentPhase;
  if (!isPhaseInLeagueRange(phase, league)) {
    return {
      success: false,
      error: "That phase isn't part of this league's schedule.",
    };
  }

  if (isPhaseLocked(phase, now)) {
    return { success: false, error: "Picks have locked for this phase." };
  }

  const events = await getEventsByPhaseWithTeams(phase.id);
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const unstartedEvents = events.filter((e) => !hasEventStarted(e, now));
  const unstartedEventIds = new Set(unstartedEvents.map((e) => e.id));

  // §7.1 #4: picks already locked in on started games consume the
  // league's picksPerPhase budget. Required count for THIS submission is
  // the remaining quota, clamped to the unstarted pool.
  const existingPicks = await getPicksForLeaguePhase(
    leagueId,
    session.user.id,
    phase.id,
  );
  const lockedPickCount = existingPicks.filter(
    (p) => !unstartedEventIds.has(p.eventId),
  ).length;
  const requiredCount = Math.min(
    Math.max(league.picksPerPhase - lockedPickCount, 0),
    unstartedEvents.length,
  );

  if (requiredCount === 0) {
    return {
      success: false,
      error:
        lockedPickCount >= league.picksPerPhase
          ? "You've already locked in all your picks for this phase."
          : "No games left to pick for this phase.",
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
    if (hasEventStarted(event, now)) {
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
  // pick is scored against what the user saw — §9.3. The client sends an
  // `expectedSpread` per pick (the line it displayed when the user hit
  // submit); if that doesn't match the server's current spread, we bail
  // with STALE_ODDS so the client can refresh and show the moved line
  // before the user commits.
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
      const serverSpread =
        sel.teamId === event.homeTeamId ? odds.homeSpread : odds.awaySpread;
      if (serverSpread == null) {
        return {
          success: false,
          error:
            "Spreads aren't available yet for one of the games. Try again in a moment.",
        };
      }
      if (sel.expectedSpread == null || sel.expectedSpread !== serverSpread) {
        return {
          success: false,
          error:
            "Lines moved while you were submitting — odds refreshed. Please review before re-submitting.",
          code: "STALE_ODDS",
        };
      }
      frozenSpreadByEventId.set(sel.eventId, serverSpread);
    }
  }

  // Replace the user's picks on unstarted events for this phase. Picks on
  // games that have already started are preserved automatically — they
  // aren't in `unstartedEvents`, so the delete leaves them untouched.
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
      Array.from(unstartedEventIds),
      tx,
    );
    await insertPicks(picksToInsert, tx);
  });

  revalidatePath(`/leagues/${leagueId}/my-picks`);
  revalidatePath(`/leagues/${leagueId}/league-picks`);
  return { success: true, data: undefined };
}
