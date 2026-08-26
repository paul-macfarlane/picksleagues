import { skipToken, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ADMIN_QUERY_KEY_PREFIX } from "@/api/admin";

/**
 * The admin Stats tab's bindings (STAT-7). Keys live under the
 * shared admin prefix so a sync-job run's invalidation (api/admin.ts) reaches
 * these browsers too — the stats sync is one of the jobs it triggers.
 */

export function adminNflStatsQueryKey(season: number | undefined) {
  return [...ADMIN_QUERY_KEY_PREFIX, "nfl-stats", season];
}

/** The season-stats browser. `season` absent = the newest stored. */
export function useAdminNflStats(season: number | undefined) {
  return useQuery({
    queryKey: adminNflStatsQueryKey(season),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/admin/nfl-stats", {
        params: { query: season === undefined ? {} : { season } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function adminNflStatContextsQueryKey(weekId: string | undefined) {
  return [...ADMIN_QUERY_KEY_PREFIX, "nfl-stat-contexts", weekId];
}

export function useAdminNflStatContexts(weekId: string | undefined) {
  return useQuery({
    queryKey: adminNflStatContextsQueryKey(weekId),
    queryFn: weekId
      ? async () => {
          const { data, error } = await api.GET("/api/admin/nfl-stat-contexts", {
            params: { query: { weekId } },
          });
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}
