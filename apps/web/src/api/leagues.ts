import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ERROR_CODE,
  type CreateLeagueRequest,
  type LeagueResponse,
  type UpdateLeagueRequest,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { toastOnExpectedError } from "@/api/refusals";

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

// A single home for the query key so every mutation across the league page's
// components invalidates (and the top-level query subscribes to) the exact
// same cache entry.
export function leagueQueryKey(leagueId: string) {
  return ["league", leagueId];
}

// Shared by the league layout route and its tab children so they all read
// the same cache entry (populated once by the layout's loading/error/404
// handling) instead of each issuing their own fetch.
export function useLeague(leagueId: string) {
  return useQuery({
    queryKey: leagueQueryKey(leagueId),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
      });
      if (error) {
        // 404 covers both "doesn't exist" and "not a member" — represent it
        // as "no league" rather than an error state (private leagues stay
        // hidden, mirrors join preview).
        if (response.status === 404) return null;
        throw error;
      }
      // The generated openapi types mark defaulted settings fields (e.g.
      // picksPerWeek) as optional even though the server always serializes
      // them — LeagueResponseSchema (packages/schemas) is the real source of
      // truth for the response shape.
      return data as LeagueResponse;
    },
  });
}

export function useCreateLeague() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateLeagueRequest) => {
      const { data, error, response } = await api.POST("/api/leagues", { body });
      if (error) {
        // cap_exceeded / no_active_season are expected outcomes the server
        // already phrases as a user-facing message — surface it verbatim.
        toastOnExpectedError(error, response, (status) => status === 409);
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      toast.success("League created");
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
      navigate({ to: "/leagues/$leagueId", params: { leagueId: data.id } });
    },
    onError: () => {
      toast.error("Couldn't create that league — please try again.");
    },
  });
}

// The merged settings form (settings-section.tsx) has one Save button for
// name/visibility/maxMembers/settings together, so it calls this hook once —
// a single `isPending` is enough to gate that one button (async-button
// standard).
export function useUpdateLeague(leagueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateLeagueRequest) => {
      const { data, error, response } = await api.PATCH("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
        body,
      });
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status) => status === 409 || status === 400,
          // maxMembers dropped below the current member count gets its own
          // clear copy rather than the generic message — mapped off the wire
          // error slug, never an inline string comparison. league_started
          // (409) or a settings shape that fails the mode's schema (400) are
          // both server-derived refusals — surface the exact message.
          (err) =>
            response.status === 409 && err.error === ERROR_CODE.MAX_MEMBERS_BELOW_MEMBER_COUNT
              ? "Can't set the cap below the current member count."
              : err.message,
        );
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      // Renames show on the dashboard card too.
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
      if (data) toast.success("League updated");
    },
    onError: () => toast.error("Couldn't update this league — please try again."),
  });
}

// Renewal mints the league's next season instance (ADR-0009). One button, one
// `isPending` gate (async-button standard) — the button only renders when the
// server says the league is renewable, so the 409 no_newer_season path is a
// defensive fallback (e.g. a concurrent renewal won the race).
export function useRenewLeague(leagueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST("/api/leagues/{leagueId}/seasons", {
        params: { path: { leagueId } },
      });
      if (error) {
        toastOnExpectedError(
          error,
          response,
          (status) => status === 409,
          (err) =>
            err.error === ERROR_CODE.NO_NEWER_SEASON
              ? "This league is already on the latest season."
              : err.message,
        );
        return null;
      }
      return data as LeagueResponse;
    },
    onSuccess: async (data) => {
      if (!data) {
        // A refused renewal may mean the league already advanced — refresh so
        // the stale "next season available" banner clears.
        await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
        return;
      }
      toast.success(`Started the ${data.seasonYear} season`);
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
    },
    onError: () => toast.error("Couldn't start the next season — please try again."),
  });
}

export function useDeleteLeague(leagueId: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
      });
      if (error) {
        toastOnExpectedError(error, response, (status) => status === 409);
        return false;
      }
      return true;
    },
    onSuccess: async (deleted) => {
      if (!deleted) {
        await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
        return;
      }
      toast.success("League deleted");
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
      navigate({ to: "/" });
    },
    onError: () => toast.error("Couldn't delete this league — please try again."),
  });
}
