import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Season-cumulative board when `weekId` is omitted, a single week's board
// otherwise — one endpoint at two scopes (spec §Standings), so one query key
// shape covers both, keyed by the resolved scope rather than "undefined".
export function leagueStandingsQueryKey(leagueId: string, weekId?: string) {
  return ["league", leagueId, "standings", weekId ?? "season"];
}

export function useLeagueStandings(leagueId: string, weekId?: string) {
  return useQuery({
    queryKey: leagueStandingsQueryKey(leagueId, weekId),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues/{leagueId}/standings", {
        params: { path: { leagueId }, query: { week: weekId } },
      });
      if (error) throw error;
      return data;
    },
  });
}
