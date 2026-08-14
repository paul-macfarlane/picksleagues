import { skipToken, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// The matchup stats read (STAT-6, ADR-0040) — shared by every NFL mode's game
// rows, NFL-qualified because the stat shapes are the sport's, not the app's
// (engineering rules §naming).

export function nflGameStatsQueryKey(gameId: string | undefined) {
  return ["nfl-game-stats", gameId];
}

/**
 * Fetches only when mounted — the sheet body mounts on first open, so a
 * 16-game slate fetches only the matchups a member actually opens (the
 * `undefined`/`skipToken` leg covers any caller that must mount unconditionally).
 * Stats move on the daily sync's schedule, so a generous staleTime keeps
 * reopening a sheet from refetching data that cannot have changed — the
 * response's own `updatedAt` stamps carry freshness, not the fetch.
 */
export function useNflGameStats(gameId: string | undefined) {
  return useQuery({
    queryKey: nflGameStatsQueryKey(gameId),
    staleTime: 5 * 60 * 1000,
    queryFn: gameId
      ? async () => {
          const { data, error } = await api.GET("/api/games/{gameId}/nfl-stats", {
            params: { path: { gameId } },
          });
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}
