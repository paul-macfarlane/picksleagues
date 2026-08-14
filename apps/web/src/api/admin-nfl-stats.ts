import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastSuccess } from "@/lib/toast";
import { ERROR_CODE } from "@picksleagues/schemas";
import type {
  NflGameStatContextOverrideRequest,
  NflTeamSeasonStatsOverrideRequest,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { ADMIN_QUERY_KEY_PREFIX } from "@/api/admin";
import { NFL_GAME_STATS_QUERY_KEY_PREFIX } from "@/api/nfl-game-stats";
import { toastOnExpectedError } from "@/api/refusals";

/**
 * The admin Stats tab's bindings (STAT-7, ADR-0041). Keys live under the
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

// Shared by both override mutations: the admin browsers must refetch, and so
// must the member-facing matchup sheet — its numbers are exactly what the
// correction changed. Unlike a game override, nothing else derives from stats
// (no settlement, no lock state), so the fan-out is enumerable and the
// whole-cache invalidation the game write needs would be overkill here.
async function invalidateStatsSurfaces(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEY_PREFIX }),
    queryClient.invalidateQueries({ queryKey: NFL_GAME_STATS_QUERY_KEY_PREFIX }),
  ]);
}

/** Three-state patch onto a team-season record row's override layer. */
export function useSetNflStatsOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      statsId,
      override,
    }: {
      statsId: string;
      /** Row context for the toast — ids alone label nothing. */
      teamAbbreviation: string;
      override: NflTeamSeasonStatsOverrideRequest;
    }) => {
      const { data, error, response } = await api.PUT("/api/admin/nfl-stats/{statsId}/override", {
        params: { path: { statsId } },
        body: override,
      });
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status, err) => status === 404 && err.error === ERROR_CODE.TEAM_SEASON_STATS_NOT_FOUND,
        );
        return null;
      }
      return data;
    },
    onSuccess: async (data, variables) => {
      if (!data) return;
      toastSuccess(
        `Saved stats override for ${variables.teamAbbreviation} ${data.stats.seasonYear}`,
      );
      await invalidateStatsSurfaces(queryClient);
    },
    onError: () => toast.error("Couldn't save that override — please try again."),
  });
}

/** Replaces a game's context override layer whole (PUT semantics). */
export function useSetNflStatContextOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      gameId,
      override,
    }: {
      gameId: string;
      override: NflGameStatContextOverrideRequest;
    }) => {
      const { data, error, response } = await api.PUT(
        "/api/admin/nfl-stat-contexts/{gameId}/override",
        {
          params: { path: { gameId } },
          body: override,
        },
      );
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status, err) => status === 404 && err.error === ERROR_CODE.GAME_STAT_CONTEXT_NOT_FOUND,
        );
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      const label = `${data.game.awayTeam.abbreviation} @ ${data.game.homeTeam.abbreviation}`;
      toastSuccess(`Saved stat context override for ${label}`);
      await invalidateStatsSurfaces(queryClient);
    },
    onError: () => toast.error("Couldn't save that override — please try again."),
  });
}
