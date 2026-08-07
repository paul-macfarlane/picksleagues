import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ERROR_CODE, JOB_RUN_STATUS, JOB_SKIP_REASON } from "@picksleagues/schemas";
import type { GameOverrideRequest, JobSkipReason, NflSyncJob, Sport } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { toastOnExpectedError } from "@/api/refusals";

// One home for the admin cache-key shape: every browser query below is
// prefixed with this, so a single invalidation after a sync job covers all
// four without the run-job hook restating the key literal.
const ADMIN_QUERY_KEY_PREFIX = ["admin"];

// Wire slug → operator copy for a run that had nothing to do. A skip is a 200,
// so without this the operator can't tell "nothing happened" from "work
// happened" — which is how a season-resolution gap stayed invisible.
const JOB_SKIP_COPY: Record<JobSkipReason, string> = {
  [JOB_SKIP_REASON.SEASON_NOT_SYNCED]: "that season isn't synced yet",
  [JOB_SKIP_REASON.WEEK_NOT_SYNCED]: "that week isn't synced yet",
  [JOB_SKIP_REASON.NO_CURRENT_WEEK]: "no current or upcoming week to sync",
  [JOB_SKIP_REASON.NO_ACTIVE_GAMES]: "no games are in flight",
};

function skipMessage(job: string, reason: unknown): string {
  const copy =
    typeof reason === "string" && reason in JOB_SKIP_COPY
      ? JOB_SKIP_COPY[reason as JobSkipReason]
      : "nothing to do";
  return `Skipped ${job} — ${copy}.`;
}

/**
 * Each job row mounts its own instance and scopes pending state off
 * `mutation.variables` (async-button standard). SyncJobsCard, SeasonsBrowser,
 * GamesBrowser, and TeamsBrowser are siblings on the same admin page reading
 * exactly the tables these jobs write, so a successful run invalidates all
 * four — otherwise a real sync and a no-op look identical to the operator.
 */
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
      if (data.status === JOB_RUN_STATUS.SKIPPED) {
        // Informational, not success: the job completed but wrote nothing, so
        // there is also nothing for the sibling browsers to refetch.
        toast.info(skipMessage(data.job, data.details?.reason));
        return;
      }
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

/**
 * `skipToken` rather than `enabled` for the not-yet-selected week: it narrows
 * `weekId` to a string inside the queryFn, so the required query param needs no
 * non-null assertion.
 */
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

export function adminAuditQueryKey(offset: number) {
  return [...ADMIN_QUERY_KEY_PREFIX, "audit", offset];
}

/**
 * The audit trail, one page at a time. The offset is part of the key so each
 * page caches separately and a page already seen comes back instantly on Back;
 * `keepPreviousData` then swaps the rows in place rather than blanking the
 * table on every click — the skeleton rule is about a view that has no data
 * yet, and a pager that re-skeletons loses the operator's place.
 *
 * `limit` stays the server default: the view offers no page-size control, and
 * sending one from here would be a second copy of that number.
 */
export function useAdminAudit(offset: number) {
  return useQuery({
    queryKey: adminAuditQueryKey(offset),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/admin/audit", {
        params: { query: { offset } },
      });
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * The one write on the admin surface (ADM-2, arch §Manual Sports Data
 * Overrides). Variables carry the game id so a row scopes its pending state off
 * `mutation.variables` rather than disabling every row (async-button standard).
 */
export function useSetGameOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ gameId, override }: { gameId: string; override: GameOverrideRequest }) => {
      const { data, error, response } = await api.PUT("/api/admin/games/{gameId}/override", {
        params: { path: { gameId } },
        body: override,
      });
      if (error) {
        // The 409 carries the recovery instruction verbatim (move the kickoff
        // into the past, or assert `scheduled` with both scores nulled in the
        // same edit), so it is shown, not replaced.
        toastOnExpectedError(
          error,
          response,
          (status, err) =>
            (status === 404 && err.error === ERROR_CODE.GAME_NOT_FOUND) ||
            (status === 409 && err.error === ERROR_CODE.OVERRIDE_UNLOCKS_GAME),
        );
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      const label = `${data.game.awayTeam.abbreviation} @ ${data.game.homeTeam.abbreviation}`;
      if (data.resettled) {
        toast.success(`Saved override for ${label}`);
      } else {
        // The correction committed — only the recompute that follows it failed.
        // Saying "couldn't save" here would be false, and the retry it invites
        // writes a second audit row; the nightly settle sweep re-derives
        // results and standings (arch D10).
        toast.warning(
          `Saved override for ${label}, but results and standings couldn't be recomputed — they'll catch up on the next settlement sweep.`,
        );
      }
      // Deliberately the whole cache, for the same reason the simulator's clock
      // mutations take it (api/sim.ts): an override moves this game's effective
      // kickoff, status and scores, which are the inputs to lock state, pick
      // visibility, join cutoffs, league start — and, because the write
      // re-settles affected leagues server-side, to every pick result and
      // standings row derived from it. The set of leagues touched isn't
      // knowable client-side, so an enumerated key list here would be a list
      // that silently goes stale — and a stale standings board after a
      // correction is the SPA lying about the exact thing the correction fixed.
      await queryClient.invalidateQueries();
    },
    onError: () => toast.error("Couldn't save that override — please try again."),
  });
}
