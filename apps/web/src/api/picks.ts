import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ERROR_CODE, type ErrorResponse, type PickemPickSubmission } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { toastOnExpectedError } from "@/api/refusals";

// A league's season weeks, clipped to its configured Start/End Week
// (spec §Pick'em League Settings) and carrying the default landing week —
// the week selector and its default source this, never deriving either
// client-side (ADR: "Use it as the initial selection rather than deriving
// one client-side").
export function leagueWeeksQueryKey(leagueId: string) {
  return ["league", leagueId, "weeks"];
}

export function useLeagueWeeks(leagueId: string) {
  return useQuery({
    queryKey: leagueWeeksQueryKey(leagueId),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues/{leagueId}/weeks", {
        params: { path: { leagueId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

// Keyed by week alone (not league): the slate endpoint serves the week's
// games with current spreads and derived lock state, independent of which
// league is viewing it.
export function weekSlateQueryKey(weekId: string | undefined) {
  return ["week-slate", weekId];
}

// `skipToken` rather than `enabled` for the not-yet-selected week: it narrows
// `weekId` to a string inside the queryFn, so the required path param needs no
// non-null assertion (same idiom as api/admin.ts's useAdminGames).
export function useWeekSlate(weekId: string | undefined) {
  return useQuery({
    queryKey: weekSlateQueryKey(weekId),
    queryFn: weekId
      ? async () => {
          const { data, error } = await api.GET("/api/weeks/{weekId}/games", {
            params: { path: { weekId } },
          });
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}

export function pickemWeekPicksQueryKey(leagueId: string, weekId: string | undefined) {
  return ["league", leagueId, "picks", weekId];
}

export function useWeekPicks(leagueId: string, weekId: string | undefined) {
  return useQuery({
    queryKey: pickemWeekPicksQueryKey(leagueId, weekId),
    queryFn: weekId
      ? async () => {
          const { data, error } = await api.GET("/api/leagues/{leagueId}/picks/week/{weekId}", {
            params: { path: { leagueId, weekId } },
          });
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}

// Wire-slug → toast copy for the batch submit's expected refusals (ADR-0015).
// `spread_stale` gets its own message pointing at the fix (re-review and
// resubmit); everything else not named here falls back to the server's own
// message, which is already user-facing phrasing.
function pickSubmissionErrorMessage(error: ErrorResponse): string {
  switch (error.error) {
    case ERROR_CODE.PICK_LOCKED:
      return "One of those games already kicked off, so it can't be changed — remove it and resubmit the rest.";
    case ERROR_CODE.SPREAD_STALE:
      return "The spread moved since you loaded this week — review the new lines and resubmit.";
    // Distinct from a stale spread: there is no line to accept yet, so
    // resubmitting won't help until the odds sync posts one.
    case ERROR_CODE.SPREAD_UNAVAILABLE:
      return "That game has no spread posted yet — it can't be picked until the line is up.";
    case ERROR_CODE.TOO_MANY_PICKS:
      return "That's more picks than this week allows.";
    case ERROR_CODE.GAME_NOT_PICKABLE:
      return "One of those games was cancelled or moved and can't be picked.";
    case ERROR_CODE.WEEK_OUT_OF_RANGE:
      return "This week is outside the league's pick range.";
    default:
      return error.message;
  }
}

// Replaces the caller's unstarted picks for the week wholesale (ADR-0015) —
// the caller must send its complete intended set and omit locked picks; the
// server retains those automatically.
export function useSubmitPicks(leagueId: string, weekId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (picks: PickemPickSubmission[]) => {
      const { data, error, response } = await api.PUT(
        "/api/leagues/{leagueId}/picks/week/{weekId}",
        { params: { path: { leagueId, weekId } }, body: { picks } },
      );
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status) => status === 400 || status === 409,
          pickSubmissionErrorMessage,
        );
        // A stale spread means the slate the member reviewed has already
        // moved — refetch it so the retry (and the numbers on screen) reflect
        // the current line rather than the one that was just rejected (the
        // spec's "accept the latest spreads" rule surfacing as a 409).
        if (response.status === 409 && error.error === ERROR_CODE.SPREAD_STALE) {
          await queryClient.invalidateQueries({ queryKey: weekSlateQueryKey(weekId) });
        }
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      toast.success("Picks saved");
      await queryClient.invalidateQueries({ queryKey: pickemWeekPicksQueryKey(leagueId, weekId) });
    },
    onError: () => toast.error("Couldn't save your picks — please try again."),
  });
}
