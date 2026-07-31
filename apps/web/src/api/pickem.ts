import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ERROR_CODE,
  type ErrorResponse,
  type PickemPickSubmission,
  type PickemRepickRequest,
} from "@picksleagues/schemas";
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

// Everything below the scope segment, for invalidating *both* boards at once.
// Derived from here rather than restated so the prefix can't drift from the key
// it is supposed to match.
export function pickemStandingsQueryPrefix(leagueId: string) {
  return ["league", leagueId, "pickem", "standings"];
}

// Season-cumulative board when `weekId` is omitted, a single week's board
// otherwise — one endpoint at two scopes (spec §Standings), so one query key
// shape covers both, keyed by the resolved scope rather than "undefined".
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

// The settings editor's pre-save warning input: how much a Pick'em-invalidating
// settings edit would destroy. Its own query key (not folded into the league
// query) since it's fetched conditionally and on a different cadence — every
// keystroke in the settings form re-derives whether the change would
// invalidate, but the count itself only needs to be fetched once per visit.
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

// Wire-slug → toast copy for the repick's expected refusals. The refusal set
// differs from the batch submit's (pick_not_replaceable, pick_not_found are
// unique to this path) even though several slugs are shared — this is a
// separate endpoint with its own rules (ADR-0015's PKM-7 paragraph), not a
// variant of the batch one.
function repickErrorMessage(error: ErrorResponse): string {
  switch (error.error) {
    case ERROR_CODE.PICK_NOT_REPLACEABLE:
      return "That game is still playable, so the pick hasn't pushed — there's nothing to substitute.";
    case ERROR_CODE.PICK_NOT_FOUND:
      return "That pick couldn't be found — refresh and try again.";
    case ERROR_CODE.PICK_LOCKED:
      return "That replacement already kicked off — choose another game.";
    case ERROR_CODE.GAME_NOT_PICKABLE:
      return "That replacement was cancelled or moved and can't be picked.";
    case ERROR_CODE.DUPLICATE_PICK:
      return "You already have a pick on that game.";
    case ERROR_CODE.SPREAD_STALE:
      return "The spread moved since you loaded this week — review the new line and try again.";
    // Distinct from a stale spread: there is no line to accept yet, so
    // retrying won't help until the odds sync posts one.
    case ERROR_CODE.SPREAD_UNAVAILABLE:
      return "That game has no spread posted yet — it can't be picked until the line is up.";
    default:
      return error.message;
  }
}

// Substitutes a pushed pick (its game cancelled or moved out of the week) for
// a replacement (spec §Cancellations, ADR-0015's PKM-7 paragraph) — the exact
// inverse of useSubmitPicks: only the replacement accepts a spread, every
// other unstarted pick keeps the one it was made at, so this deliberately
// never routes through the batch endpoint.
export function useRepick(leagueId: string, weekId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: PickemRepickRequest) => {
      const { data, error, response } = await api.POST(
        "/api/leagues/{leagueId}/pickem/weeks/{weekId}/repick",
        { params: { path: { leagueId, weekId } }, body: request },
      );
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status) => status === 400 || status === 404 || status === 409,
          repickErrorMessage,
        );
        // Same recovery as the batch path: a stale spread means the slate the
        // member reviewed has already moved, so refetch it before they retry.
        if (response.status === 409 && error.error === ERROR_CODE.SPREAD_STALE) {
          await queryClient.invalidateQueries({ queryKey: weekSlateQueryKey(weekId) });
        }
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      toast.success("Pick substituted");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pickemWeekPicksQueryKey(leagueId, weekId) }),
        // Standings too — uniquely among the pick endpoints. A substitution
        // surrenders an already-graded push, so the server re-settles the week
        // as part of the request and both boards have genuinely changed. The
        // batch submit needs no equivalent: it can only replace picks on
        // unstarted games, which have no results to invalidate.
        //
        // Prefix-matched so the weekly and season boards are both caught. This
        // is not belt-and-braces: today the substitute control only lives on My
        // Picks, which renders no standings, so the numbers happen to come back
        // right when the member navigates to a tab that does. That is incidental
        // — it depends on the control and the board never sharing a screen, and
        // would break silently the first time they did.
        queryClient.invalidateQueries({ queryKey: pickemStandingsQueryPrefix(leagueId) }),
      ]);
    },
    onError: () => toast.error("Couldn't substitute that pick — please try again."),
  });
}
