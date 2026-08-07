import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ERROR_CODE,
  type SimClockAdjustment,
  type SimResetRequest,
  type UpdateSimFixtureGameRequest,
  type WeekType,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { toastOnExpectedError } from "@/api/refusals";
import { formatDateTime } from "@/lib/format";

// The simulator's bindings (SIM-7). Every route behind these hooks is
// unregistered outside a sim-enabled environment (ADR-0011/ADR-0014), so
// callers gate on `me.simEnabled` before mounting them — a 404 here means the
// caller skipped that check, not that the request was malformed.
const SIM_QUERY_KEY_PREFIX = ["sim"];

export const SIM_STATE_QUERY_KEY = [...SIM_QUERY_KEY_PREFIX, "state"];

// The simulated clock is a persisted *offset*, not a frozen instant, so it
// advances with real time and a mounted panel drifts from the server without a
// refetch. Polled rather than ticked client-side: the server owns "now"
// (arch D13), and SPA-side clock arithmetic would be a second source of truth.
const SIM_STATE_REFETCH_MS = 15_000;

export function useSimState(enabled = true) {
  return useQuery({
    queryKey: SIM_STATE_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/sim/state");
      if (error) throw error;
      return data;
    },
    enabled,
    refetchInterval: SIM_STATE_REFETCH_MS,
  });
}

// Deliberately the whole cache, for every sim mutation. The simulated clock is
// the input to every derived read in the app — lock state, join cutoffs, league
// status, and what the provider projects into the admin browsers (arch D13) —
// so moving it or swapping the scenario underneath invalidates essentially
// everything. Enumerating the affected keys would be a list that silently goes
// stale as the app grows tables, which is the failure mode that matters here:
// a stale query after a clock jump is the SPA telling the operator a lie about
// the exact thing the simulator exists to change.
async function invalidateClockDerived(queryClient: QueryClient) {
  await queryClient.invalidateQueries();
}

export function useAdjustSimClock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (adjustment: SimClockAdjustment) => {
      const { data, error, response } = await api.POST("/api/sim/clock", { body: adjustment });
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status, err) =>
            status === 404 &&
            (err.error === ERROR_CODE.WEEK_NOT_FOUND || err.error === ERROR_CODE.WEEK_HAS_NO_GAMES),
        );
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      // The resulting instant, not "done": the whole point of the control is
      // where the clock landed, and a week anchor makes that non-obvious.
      toast.success(`Simulated now: ${formatDateTime(data.clock.now)}`);
      await invalidateClockDerived(queryClient);
    },
    onError: () => toast.error("Couldn't move the simulated clock — please try again."),
  });
}

/**
 * Variables are the slug so a scenario list can scope its pending button off
 * `mutation.variables` rather than disabling every row (async-button standard).
 */
export function useLoadSimScenario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => {
      const { data, error, response } = await api.POST("/api/sim/scenarios/{slug}/load", {
        params: { path: { slug } },
      });
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status, err) => status === 404 && err.error === ERROR_CODE.SCENARIO_NOT_FOUND,
        );
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      // Loading always repositions the clock to the scenario's start (ADR-0012),
      // so the confirmation names both or it looks like nothing moved.
      toast.success(
        `Loaded ${data.activeScenario?.name ?? "scenario"} — simulated now ${formatDateTime(data.clock.now)}`,
      );
      await invalidateClockDerived(queryClient);
    },
    onError: () => toast.error("Couldn't load that scenario — please try again."),
  });
}

export function useImportReplaySeason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (seasonYear: number) => {
      const { data, error } = await api.POST("/api/sim/scenarios/replay", {
        body: { seasonYear },
      });
      if (error) {
        // This route answers 400 with an `ErrorResponse` but 500 with the job
        // envelope, so the union is narrowed by the slug's presence rather than
        // by status. Only the 400 is actionable ("that season isn't finished");
        // a failed import has no per-status recovery, same as the sync jobs.
        toast.error(
          "error" in error && error.error === ERROR_CODE.SEASON_NOT_AVAILABLE
            ? error.message
            : "Replay import failed — check the server logs.",
        );
        return null;
      }
      return data;
    },
    onSuccess: async (data, seasonYear) => {
      if (!data) return;
      toast.success(
        `Imported ${seasonYear}: ${data.details?.games ?? 0} games in ${data.durationMs}ms`,
      );
      await invalidateClockDerived(queryClient);
    },
    onError: () => toast.error("Replay import failed — check the server logs."),
  });
}

export function simFixtureGamesQueryKey(
  scenarioId: string | undefined,
  weekType: WeekType | undefined,
  weekNumber: number | undefined,
) {
  return [...SIM_QUERY_KEY_PREFIX, "fixtures", scenarioId, weekType, weekNumber];
}

/**
 * `skipToken` rather than `enabled` for the not-yet-chosen scenario: it narrows
 * `scenarioId` to a string inside the queryFn, so the required query param needs
 * no non-null assertion (same idiom as useAdminGames).
 */
export function useSimFixtureGames(
  scenarioId: string | undefined,
  weekType?: WeekType,
  weekNumber?: number,
) {
  return useQuery({
    queryKey: simFixtureGamesQueryKey(scenarioId, weekType, weekNumber),
    queryFn: scenarioId
      ? async () => {
          const { data, error } = await api.GET("/api/sim/fixtures/games", {
            params: { query: { scenarioId, weekType, weekNumber } },
          });
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}

export function useUpdateSimFixtureGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      gameId,
      patch,
    }: {
      gameId: string;
      patch: UpdateSimFixtureGameRequest;
    }) => {
      const { data, error, response } = await api.PATCH("/api/sim/fixtures/games/{gameId}", {
        params: { path: { gameId } },
        body: patch,
      });
      if (error) {
        // Both refusals carry copy worth showing verbatim — the 400 in
        // particular explains *why* an edit is incoherent ("a final fixture
        // needs both scores"), which is the whole recovery instruction.
        toastOnExpectedError(
          error,
          response,
          (status, err) =>
            (status === 404 && err.error === ERROR_CODE.FIXTURE_NOT_FOUND) ||
            (status === 400 && err.error === ERROR_CODE.VALIDATION),
        );
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      toast.success(`Updated ${data.awayTeamAbbr} @ ${data.homeTeamAbbr}`);
      // Only the simulator's own keys, deliberately unlike the clock mutations:
      // editing a fixture changes what a *subsequent* sync would ingest, not
      // any table the rest of the app reads right now.
      await queryClient.invalidateQueries({ queryKey: SIM_QUERY_KEY_PREFIX });
    },
    onError: () => toast.error("Couldn't update that fixture — please try again."),
  });
}

export function useResetSim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SimResetRequest) => {
      const { data, error, response } = await api.POST("/api/sim/reset", { body: request });
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status, err) => status === 404 && err.error === ERROR_CODE.LEAGUE_NOT_FOUND,
        );
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      const rows = Object.values(data.deleted).reduce((total, count) => total + count, 0);
      // Row counts *and* the landing instant: an operator needs to see the reset
      // actually hit something (a no-op is otherwise indistinguishable from a
      // win), and an environment reset that keeps the scenario also rewinds the
      // clock to that scenario's start (reset.ts) — a move nothing else reports.
      toast.success(
        `Reset ${data.scope}: ${rows} rows deleted — simulated now ${formatDateTime(data.state.clock.now)}`,
      );
      await invalidateClockDerived(queryClient);
    },
    onError: () => toast.error("Couldn't reset — please try again."),
  });
}
