import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastSuccess } from "@/lib/toast";
import {
  ERROR_CODE,
  type ErrorResponse,
  type SubmitSurvivorPickRequest,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { toastOnExpectedError } from "@/api/refusals";
import { weekSlateQueryKey } from "@/api/weeks";

export function survivorWeekPicksQueryKey(leagueId: string, weekId: string | undefined) {
  return ["league", leagueId, "survivor", "picks", weekId];
}

/**
 * The week's picks as this member is allowed to see them: their own pick
 * always, another member's only once its game has kicked off, plus the teams
 * this member has already burned. The consumed list arrives excluding the
 * requested week, so it is exactly the set to disable — the client never does
 * that arithmetic itself.
 */
export function useSurvivorWeekPicks(leagueId: string, weekId: string | undefined) {
  return useQuery({
    queryKey: survivorWeekPicksQueryKey(leagueId, weekId),
    // `skipToken` rather than `enabled` for the not-yet-selected week: it
    // narrows `weekId` to a string inside the queryFn, so the required path
    // param needs no non-null assertion (same idiom as api/weeks.ts).
    queryFn: weekId
      ? async () => {
          const { data, error } = await api.GET(
            "/api/leagues/{leagueId}/survivor/weeks/{weekId}/picks",
            { params: { path: { leagueId, weekId } } },
          );
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}

export function survivorStandingsQueryKey(leagueId: string) {
  return ["league", leagueId, "survivor", "standings"];
}

/**
 * The survivor board (spec §Standings View). One scope only — Survivor has no
 * weekly/season toggle, because there is nothing cumulative to total: the mode
 * grades survive-or-eliminate and the season *is* the board (ADR-0016).
 *
 * Everything it returns is already filtered to what this member may see, so the
 * UI renders it as given: withheld picks arrive with a null team, and a
 * consumed-team list is never larger than the picks behind it.
 */
export function useSurvivorStandings(leagueId: string) {
  return useQuery({
    queryKey: survivorStandingsQueryKey(leagueId),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues/{leagueId}/survivor/standings", {
        params: { path: { leagueId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

// Wire-slug → toast copy for the pick write's expected refusals. Each message
// names what the member can do about it; anything not listed falls back to the
// server's own message, which is already user-facing phrasing.
function survivorPickErrorMessage(error: ErrorResponse): string {
  switch (error.error) {
    // The picked game kicked off while they were choosing. Unlike Pick'em this
    // costs them nothing already banked — but the week is settled for them now,
    // whichever team they had in.
    case ERROR_CODE.PICK_LOCKED:
      return "That game kicked off, so this week's pick can't be changed any more.";
    case ERROR_CODE.GAME_NOT_PICKABLE:
      return "That game was cancelled and can't be picked — take a team from another game.";
    case ERROR_CODE.TEAM_NOT_IN_GAME:
      return "That team isn't playing in that game — reload this week and try again.";
    // The one refusal unique to this mode's core rule (spec §Game Mode 2 — team
    // reuse), so it names the rule rather than just the failure.
    case ERROR_CODE.TEAM_CONSUMED:
      return "You've already used that team this season — each team can only be picked once.";
    case ERROR_CODE.MEMBER_ELIMINATED:
      return "You've been eliminated, so you can't make any more picks.";
    case ERROR_CODE.WEEK_NOT_OPEN:
      return "That week isn't open for picks yet — it opens once your current pick resolves.";
    case ERROR_CODE.LEAGUE_CONCLUDED:
      return "This league has concluded, so its picks are closed.";
    case ERROR_CODE.WEEK_OUT_OF_RANGE:
      return "This week is outside the league's pick range.";
    case ERROR_CODE.GAME_NOT_IN_WEEK:
      return "That game isn't part of this week — reload this week and try again.";
    case ERROR_CODE.WRONG_LEAGUE_MODE:
      return "This isn't a Survivor league.";
    case ERROR_CODE.LEAGUE_NOT_FOUND:
      return "This league doesn't exist, or you're no longer a member.";
    default:
      return error.message;
  }
}

/**
 * The member's team for the week — an upsert, not an append: saving again
 * simply replaces, right up until the picked game kicks off. This is *not*
 * Pick'em's one-immutable-submission semantic (ADR-0018), so there is no
 * confirmation to clear before it fires.
 */
export function useSubmitSurvivorPick(leagueId: string, weekId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pick: SubmitSurvivorPickRequest) => {
      const { data, error, response } = await api.PUT(
        "/api/leagues/{leagueId}/survivor/weeks/{weekId}/pick",
        { params: { path: { leagueId, weekId } }, body: pick },
      );
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status) => status === 400 || status === 404 || status === 409,
          survivorPickErrorMessage,
        );
        // Either means the slate the member chose against has already moved — a
        // game kicked off, or a game was pulled — so refetch it rather than
        // leave them re-saving the same dead offer.
        if (
          error.error === ERROR_CODE.PICK_LOCKED ||
          error.error === ERROR_CODE.GAME_NOT_PICKABLE
        ) {
          await queryClient.invalidateQueries({ queryKey: weekSlateQueryKey(weekId) });
        }
        // Both refusals are the server disagreeing with the ledger this screen
        // disabled teams from, or with its belief that the member is still
        // alive — and the week's own picks response is where both of those
        // facts live.
        if (
          error.error === ERROR_CODE.TEAM_CONSUMED ||
          error.error === ERROR_CODE.MEMBER_ELIMINATED ||
          // The window fact (`pickWindowOpen`) also lives on the week's own
          // picks response, and this refusal means the screen's copy of it is
          // stale (ADR-0036).
          error.error === ERROR_CODE.WEEK_NOT_OPEN
        ) {
          await queryClient.invalidateQueries({
            queryKey: survivorWeekPicksQueryKey(leagueId, weekId),
          });
        }
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      toastSuccess("Pick saved");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: survivorWeekPicksQueryKey(leagueId, weekId),
        }),
        // The board carries this member's own history and consumed teams, both
        // of which the write just moved — unlike Pick'em, whose board is
        // settlement's alone and cannot change from a pick screen.
        queryClient.invalidateQueries({ queryKey: survivorStandingsQueryKey(leagueId) }),
      ]);
    },
    onError: () => toast.error("Couldn't save your pick — please try again."),
  });
}
