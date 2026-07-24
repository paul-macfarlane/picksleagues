import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { ErrorResponse, MemberRole } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { toastOnExpectedError } from "@/api/refusals";
import { leagueQueryKey, MY_LEAGUES_QUERY_KEY } from "@/api/leagues";

export function useUpdateMemberRole(leagueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: MemberRole }) => {
      const { error, response } = await api.PATCH("/api/leagues/{leagueId}/members/{memberId}", {
        params: { path: { leagueId, memberId } },
        body: { role },
      });
      if (error) {
        // cap_exceeded / last_commissioner are expected refusals the server
        // already phrases — surface verbatim, don't throw.
        toastOnExpectedError(error, response, (status) => status === 409);
        return null;
      }
      return true;
    },
    onSuccess: async () => {
      // Role changes alter the dashboard's commissioner badge too.
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
    },
    onError: () => toast.error("Couldn't update that member's role — please try again."),
  });
}

export function useKickMember(leagueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error, response } = await api.DELETE("/api/leagues/{leagueId}/members/{memberId}", {
        params: { path: { leagueId, memberId } },
      });
      if (error) {
        toastOnExpectedError(error, response, (status) => status === 409 || status === 400);
        return null;
      }
      return true;
    },
    onSuccess: async () => {
      // Kicks change the member count the dashboard card shows.
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
    },
    onError: () => toast.error("Couldn't remove that member — please try again."),
  });
}

// Moved from the Danger Zone (item 4/5 consolidation) — every member,
// regardless of role, can leave from here; a sole member leaving deletes
// the league (server-enforced, unchanged).
export function useLeaveLeague(leagueId: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE("/api/leagues/{leagueId}/members/me", {
        params: { path: { leagueId } },
      });
      if (error) {
        toastOnExpectedError(error, response, (status) => status === 409);
        return false;
      }
      return true;
    },
    onSuccess: async (left) => {
      if (!left) {
        await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
        return;
      }
      toast.success("Left the league");
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
      navigate({ to: "/" });
    },
    onError: () => toast.error("Couldn't leave this league — please try again."),
  });
}

// Sanctioned consolidation 1: joining by invite code and joining a public
// league from Discovery share identical refusal/success handling — only the
// underlying fetch and the "blocked" behavior (join.$code's preview refetch)
// differ per caller, so those are the two things callers supply.
function useJoinMutation<T extends { id: string; name: string }>(
  join: () => Promise<{ data?: T; error?: ErrorResponse; response: Response }>,
  onBlocked?: () => void | Promise<void>,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await join();
      if (error) {
        // Blocked (already a member, join closed, etc.) is expected and the
        // server already phrases it — surface verbatim, don't throw.
        toastOnExpectedError(error, response, (status) => status === 409);
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) {
        await onBlocked?.();
        return;
      }
      toast.success(`Joined ${data.name}`);
      await queryClient.invalidateQueries({ queryKey: MY_LEAGUES_QUERY_KEY });
      navigate({ to: "/leagues/$leagueId", params: { leagueId: data.id } });
    },
    onError: () => {
      toast.error("Couldn't join that league — please try again.");
    },
  });
}

// A blocked join can mean the invite preview is stale (e.g. someone else just
// took the last spot) — join.$code.tsx passes `onBlocked` to refetch it.
export function useJoinByCode(code: string, onBlocked?: () => void | Promise<void>) {
  return useJoinMutation(
    () => api.POST("/api/join/{code}", { params: { path: { code } } }),
    onBlocked,
  );
}

export function useJoinPublicLeague(leagueId: string) {
  return useJoinMutation(() =>
    api.POST("/api/leagues/{leagueId}/join", { params: { path: { leagueId } } }),
  );
}
