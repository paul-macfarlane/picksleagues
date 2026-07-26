import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { NflSyncJob, Sport } from "@picksleagues/schemas";
import { api } from "@/lib/api";

// One home for the admin cache-key shape: every browser query below is
// prefixed with this, so a single invalidation after a sync job covers all
// four without the run-job hook restating the key literal. Exported because
// the sim mutations (api/sim.ts) rewrite the same tables these browsers read.
export const ADMIN_QUERY_KEY_PREFIX = ["admin"];

// Each job row mounts its own instance and scopes pending state off
// `mutation.variables` (async-button standard). SyncJobsCard, SeasonsBrowser,
// GamesBrowser, and TeamsBrowser are siblings on the same admin page reading
// exactly the tables these jobs write, so a successful run invalidates all
// four — otherwise a real sync and a no-op look identical to the operator.
export function useRunNflSyncJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (job: NflSyncJob) => {
      const { data, error } = await api.POST("/api/admin/jobs/nfl/{job}", {
        params: { path: { job } },
      });
      if (error) {
        // 400/401/403/500 all land here — the admin page has no per-status
        // recovery action, so every non-2xx gets the same "go check the logs"
        // copy rather than surfacing the wire message.
        toast.error("Job failed — check the server logs.");
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      toast.success(`Ran ${data.job} in ${data.durationMs}ms`);
      await queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEY_PREFIX });
    },
    onError: () => toast.error("Job failed — check the server logs."),
  });
}

// The four read-only browsers below are inspection surfaces (arch §Manual
// Sports Data Overrides) — plain queries, no mutation/toast wiring.

export function adminTeamsQueryKey(sport: Sport) {
  return [...ADMIN_QUERY_KEY_PREFIX, "teams", sport];
}

export function useAdminTeams(sport: Sport) {
  return useQuery({
    queryKey: adminTeamsQueryKey(sport),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/admin/teams", {
        params: { query: { sport } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function adminSeasonsQueryKey(sport: Sport) {
  return [...ADMIN_QUERY_KEY_PREFIX, "seasons", sport];
}

export function useAdminSeasons(sport: Sport) {
  return useQuery({
    queryKey: adminSeasonsQueryKey(sport),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/admin/seasons", {
        params: { query: { sport } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function adminGamesQueryKey(weekId: string | undefined) {
  return [...ADMIN_QUERY_KEY_PREFIX, "games", weekId];
}

// `skipToken` rather than `enabled` for the not-yet-selected week: it narrows
// `weekId` to a string inside the queryFn, so the required query param needs no
// non-null assertion.
export function useAdminGames(weekId: string | undefined) {
  return useQuery({
    queryKey: adminGamesQueryKey(weekId),
    queryFn: weekId
      ? async () => {
          const { data, error } = await api.GET("/api/admin/games", {
            params: { query: { weekId } },
          });
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}

export function adminGameOddsQueryKey(gameId: string) {
  return [...ADMIN_QUERY_KEY_PREFIX, "games", gameId, "odds"];
}

// Odds history is expensive relative to the other browsers (a query per
// game) so it's opt-in: the games browser only enables this once a game's
// disclosure is opened.
export function useAdminGameOdds(gameId: string, enabled: boolean) {
  return useQuery({
    queryKey: adminGameOddsQueryKey(gameId),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/admin/games/{gameId}/odds", {
        params: { path: { gameId } },
      });
      if (error) throw error;
      return data;
    },
    enabled,
  });
}
