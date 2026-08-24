import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastSuccess } from "@/lib/toast";
import { pickSavedHaptic } from "@/lib/haptics";
import { ERROR_CODE, type ErrorResponse, type PickemPickSubmission } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { toastOnExpectedError } from "@/api/refusals";
import { weekSlateQueryKey } from "@/api/weeks";

export function pickemWeekPicksQueryKey(leagueId: string, weekId: string | undefined) {
  return ["league", leagueId, "pickem", "picks", weekId];
}

export function useWeekPicks(leagueId: string, weekId: string | undefined) {
  return useQuery({
    queryKey: pickemWeekPicksQueryKey(leagueId, weekId),
    // `skipToken` rather than `enabled` for the not-yet-selected week: it
    // narrows `weekId` to a string inside the queryFn, so the required path
    // param needs no non-null assertion.
    queryFn: weekId
      ? async () => {
          const { data, error } = await api.GET(
            "/api/leagues/{leagueId}/pickem/weeks/{weekId}/picks",
            { params: { path: { leagueId, weekId } } },
          );
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}

// Everything above the scope segment, so a future caller can invalidate *both*
// boards at once. Derived from here rather than restated so the prefix can't
// drift from the key it is supposed to match. Local since ADR-0018 removed the
// one mutation that re-settled a week from the pick screen — no pick write can
// now change a board the member is looking at.
function pickemStandingsQueryPrefix(leagueId: string) {
  return ["league", leagueId, "pickem", "standings"];
}

/**
 * Season-cumulative board when `weekId` is omitted, a single week's board
 * otherwise — one endpoint at two scopes (spec §Standings), so one query key
 * shape covers both, keyed by the resolved scope rather than "undefined".
 */
export function pickemStandingsQueryKey(leagueId: string, weekId?: string) {
  return [...pickemStandingsQueryPrefix(leagueId), weekId ?? "season"];
}

export function usePickemStandings(leagueId: string, weekId?: string) {
  return useQuery({
    queryKey: pickemStandingsQueryKey(leagueId, weekId),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues/{leagueId}/pickem/standings", {
        params: { path: { leagueId }, query: { week: weekId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * The settings editor's pre-save warning input: how much a Pick'em-invalidating
 * settings edit would destroy. Its own query key (not folded into the league
 * query) since it's fetched conditionally and on a different cadence — every
 * keystroke in the settings form re-derives whether the change would
 * invalidate, but the count itself only needs to be fetched once per visit.
 */
export function pickemPickSummaryQueryKey(leagueId: string) {
  return ["league", leagueId, "pickem", "pick-summary"];
}

export function usePickemPickSummary(leagueId: string, enabled: boolean) {
  return useQuery({
    queryKey: pickemPickSummaryQueryKey(leagueId),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues/{leagueId}/pickem/pick-summary", {
        params: { path: { leagueId } },
      });
      if (error) throw error;
      return data;
    },
    // Only a commissioner editing settings needs this — an ordinary member
    // viewing (read-only) settings must never fire it (403 otherwise, and no
    // reason to leak another member's pick activity).
    enabled,
  });
}

// Wire-slug → toast copy for the one submission's expected refusals
// (ADR-0018). Each message names what the member can do about it; everything
// not listed falls back to the server's own message, which is already
// user-facing phrasing.
function pickSubmissionErrorMessage(error: ErrorResponse): string {
  switch (error.error) {
    // Normally two tabs, or the member racing themselves. The refetch below
    // replaces the sheet with what they already have in.
    case ERROR_CODE.ALREADY_SUBMITTED:
      return "Your picks for this week are already in — a week can only be submitted once.";
    case ERROR_CODE.PICK_SET_INCOMPLETE:
      return "That isn't a full set for this week — pick every game the week still allows.";
    case ERROR_CODE.TOO_MANY_PICKS:
      return "That's more picks than this week allows.";
    case ERROR_CODE.PICK_LOCKED:
      return "One of those games kicked off while you were picking — review the week and submit again.";
    case ERROR_CODE.SPREAD_STALE:
      return "The spread moved since you loaded this week — review the new lines and submit again.";
    // Distinct from a stale spread: there is no line to accept yet, so
    // submitting again won't help until the odds sync posts one.
    case ERROR_CODE.SPREAD_UNAVAILABLE:
      return "That game has no spread posted yet — it can't be picked until the line is up.";
    case ERROR_CODE.GAME_NOT_PICKABLE:
      return "One of those games was cancelled and can't be picked.";
    case ERROR_CODE.WEEK_NOT_OPEN:
      return "That week isn't open for picks yet — it opens once all of your current picks resolve.";
    case ERROR_CODE.WEEK_OUT_OF_RANGE:
      return "This week is outside the league's pick range.";
    default:
      return error.message;
  }
}

/**
 * The member's one submission for the week (ADR-0018 decision 1): the full
 * required set, in one call, never edited afterwards. The caller confirms
 * irreversibility before this fires.
 */
export function useSubmitPicks(leagueId: string, weekId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (picks: PickemPickSubmission[]) => {
      const { data, error, response } = await api.PUT(
        "/api/leagues/{leagueId}/pickem/weeks/{weekId}/picks",
        { params: { path: { leagueId, weekId } }, body: { picks } },
      );
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status) => status === 400 || status === 409,
          pickSubmissionErrorMessage,
        );
        // Both of these mean the slate the member assembled against has already
        // moved — a line changed, or a game kicked off — so refetch it. Under
        // submit-once a rejected sheet is the member's *only* attempt at the
        // week until they can build a valid one, so leaving stale numbers and a
        // now-unpickable row on screen would strand them there.
        if (
          response.status === 409 &&
          (error.error === ERROR_CODE.SPREAD_STALE || error.error === ERROR_CODE.PICK_LOCKED)
        ) {
          await queryClient.invalidateQueries({ queryKey: weekSlateQueryKey(weekId) });
        }
        // Their picks are already in; refetching is what shows them, since the
        // week's own submitted view is the honest answer to "why was that
        // refused".
        if (
          response.status === 409 &&
          (error.error === ERROR_CODE.ALREADY_SUBMITTED ||
            // The window fact (`pickWindowOpen`) lives on the same response,
            // and this refusal means the screen's copy of it is stale
            // (ADR-0036).
            error.error === ERROR_CODE.WEEK_NOT_OPEN)
        ) {
          await queryClient.invalidateQueries({
            queryKey: pickemWeekPicksQueryKey(leagueId, weekId),
          });
        }
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      pickSavedHaptic();
      toastSuccess("Picks submitted");
      await queryClient.invalidateQueries({ queryKey: pickemWeekPicksQueryKey(leagueId, weekId) });
    },
    onError: () => toast.error("Couldn't submit your picks — please try again."),
  });
}
