import { skipToken, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// The mode-agnostic week surfaces: which weeks a league plays, and the game
// slate a week is made of. Every NFL mode reads both, so they sit outside
// api/pickem.ts.

/**
 * A league's season weeks, clipped to its configured Start/End Week
 * (spec §Pick'em League Settings) and carrying the default landing week —
 * the week selector and its default source this, never deriving either
 * client-side (ADR: "Use it as the initial selection rather than deriving
 * one client-side").
 */
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

/**
 * Keyed by week alone (not league): the slate endpoint serves the week's
 * games with current spreads and derived lock state, independent of which
 * league is viewing it.
 */
export function weekSlateQueryKey(weekId: string | undefined) {
  return ["week-slate", weekId];
}

/**
 * `skipToken` rather than `enabled` for the not-yet-selected week: it narrows
 * `weekId` to a string inside the queryFn, so the required path param needs no
 * non-null assertion (same idiom as api/admin.ts's useAdminGames).
 */
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
