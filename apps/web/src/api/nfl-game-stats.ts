import { skipToken, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// The matchup stats read (STAT-6, ADR-0040) — shared by every NFL mode's game
// rows, NFL-qualified because the stat shapes are the sport's, not the app's
// (engineering rules §naming).

/**
 * Exported for the admin stats-override mutations' invalidation fan-out
 * (api/admin.ts): a stats correction changes what this surface serves, and the
 * prefix belongs here so no other module restates the key literal.
 */
export const NFL_GAME_STATS_QUERY_KEY_PREFIX = ["nfl-game-stats"];

export function nflGameStatsQueryKey(gameId: string | undefined) {
  return [...NFL_GAME_STATS_QUERY_KEY_PREFIX, gameId];
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

export function nflGameResultsQueryKey(gameId: string | undefined) {
  return ["nfl-game-results", gameId];
}

/**
 * The Results segment's game logs (STAT-9) — its own lazy fetch, mounted only
 * when a member actually selects Results, so the common sheet open pays
 * nothing for it. Shorter staleTime than the stats read: a live game's score
 * moves on the score sync's ~15-minute cadence (ADR-0044), and the response's `updatedAt`
 * carries the honest as-of stamp either way.
 */
export function useNflGameResults(gameId: string | undefined) {
  return useQuery({
    queryKey: nflGameResultsQueryKey(gameId),
    staleTime: 60 * 1000,
    queryFn: gameId
      ? async () => {
          const { data, error } = await api.GET("/api/games/{gameId}/nfl-results", {
            params: { path: { gameId } },
          });
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}
