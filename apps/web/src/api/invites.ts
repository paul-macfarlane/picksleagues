import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { toastOnExpectedError } from "@/api/refusals";

export function leagueInvitesQueryKey(leagueId: string) {
  return ["league-invites", leagueId];
}

export function useLeagueInvites(leagueId: string, enabled: boolean) {
  return useQuery({
    queryKey: leagueInvitesQueryKey(leagueId),
    queryFn: async () => {
      const { data, error } = await api.GET("/api/leagues/{leagueId}/invites", {
        params: { path: { leagueId } },
      });
      if (error) throw error;
      return data;
    },
    // Only a commissioner can list invites (403 otherwise) — this panel is
    // only ever mounted for commissioners, but the guard stays explicit.
    enabled,
  });
}

export function useCreateInvite(leagueId: string) {
  const queryClient = useQueryClient();
  const invitesQueryKey = leagueInvitesQueryKey(leagueId);
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST("/api/leagues/{leagueId}/invites", {
        params: { path: { leagueId } },
      });
      if (error) {
        // 409 `league_started` is reachable even with the button disabled: the
        // window can close between the page's last league read and the submit.
        toastOnExpectedError(error, response, (status) => status === 409);
        return null;
      }
      return data;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      if (data) toast.success("Invite created");
    },
    onError: () => toast.error("Couldn't create an invite — please try again."),
  });
}

export function useRevokeInvite(leagueId: string) {
  const queryClient = useQueryClient();
  const invitesQueryKey = leagueInvitesQueryKey(leagueId);
  return useMutation({
    mutationFn: async (code: string) => {
      const { error } = await api.DELETE("/api/leagues/{leagueId}/invites/{code}", {
        params: { path: { leagueId, code } },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
    },
    onError: () => toast.error("Couldn't revoke that invite — please try again."),
  });
}

export function joinPreviewQueryKey(code: string) {
  return ["join-preview", code];
}

export function useJoinPreview(code: string) {
  return useQuery({
    queryKey: joinPreviewQueryKey(code),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/join/{code}", {
        params: { path: { code } },
      });
      if (error) {
        // Invalid code is a friendly card, not a toast — represent it as
        // "no preview" rather than an error state.
        if (response.status === 404) return null;
        throw error;
      }
      return data;
    },
  });
}
