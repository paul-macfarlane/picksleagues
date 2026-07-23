import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Single home for the "current user's leagues" cache key + query — the
// dashboard's league list and the navbar's league switcher both read this
// same entry. Call sites that only invalidate the key (member/settings
// mutations) keep their own ["my-leagues"] literal this round; this constant
// exists so new reads don't mint another inline literal.
export const MY_LEAGUES_QUERY_KEY = ["my-leagues"];

export function useMyLeagues() {
  return useQuery({
    queryKey: MY_LEAGUES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues");
      if (error) throw error;
      return data;
    },
  });
}
