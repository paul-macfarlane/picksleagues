import { useQuery } from "@tanstack/react-query";
import {
  canPerformLeagueAction,
  type LeagueAction,
  type LeagueResponse,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { leagueQueryKey } from "@/components/league/query-key";

// Shared by the league layout route and its tab children so they all read
// the same cache entry (populated once by the layout's loading/error/404
// handling) instead of each issuing their own fetch.
export function useLeague(leagueId: string) {
  return useQuery({
    queryKey: leagueQueryKey(leagueId),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
      });
      if (error) {
        // 404 covers both "doesn't exist" and "not a member" — represent it
        // as "no league" rather than an error state (private leagues stay
        // hidden, mirrors join preview).
        if (response.status === 404) return null;
        throw error;
      }
      // The generated openapi types mark defaulted settings fields (e.g.
      // pushTieResolution) as optional even though the server always
      // serializes them — LeagueResponseSchema (packages/schemas) is the
      // real source of truth for the response shape.
      return data as LeagueResponse;
    },
  });
}

// Section visibility runs on the LEAGUE_ACTION matrix's role axis only:
// `preStart: true` renders controls optimistically, and the server's 409
// (league_started) enforces the window — the client never computes "now"
// (arch D11).
export function canActOnLeague(league: LeagueResponse, action: LeagueAction) {
  return canPerformLeagueAction(action, { role: league.myRole, preStart: true });
}
