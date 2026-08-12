import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { LeagueMode } from "@picksleagues/schemas";
import { api } from "@/lib/api";

export interface DiscoveryFilters {
  q: string;
  mode: LeagueMode | null;
  page: number;
}

export function discoveryQueryKey(filters: DiscoveryFilters) {
  return ["discovery", filters.q, filters.mode, filters.page];
}

/**
 * `keepPreviousData` so paging and filtering swap the grid in place instead of
 * blanking it back to skeletons — the skeleton rule is about a view with no
 * data yet, and a list that re-skeletons on every page click loses the reader's
 * place (same reason the audit log does it).
 */
export function useDiscovery(filters: DiscoveryFilters) {
  return useQuery({
    queryKey: discoveryQueryKey(filters),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/discovery", {
        params: {
          query: {
            q: filters.q || undefined,
            mode: filters.mode ?? undefined,
            page: filters.page,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
  });
}
