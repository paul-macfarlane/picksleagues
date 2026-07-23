import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function discoveryQueryKey(q: string) {
  return ["discovery", q];
}

export function useDiscovery(q: string) {
  return useQuery({
    queryKey: discoveryQueryKey(q),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/discovery", {
        params: { query: { q: q || undefined } },
      });
      if (error) throw error;
      return data;
    },
  });
}
