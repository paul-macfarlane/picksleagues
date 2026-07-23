import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Single home for the "current user's leagues" cache key + query — readers
// (dashboard, navbar switcher) and every invalidation call site share this
// constant so the key can never drift.
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
