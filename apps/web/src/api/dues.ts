import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastSuccess } from "@/lib/toast";
import { api } from "@/lib/api";
import { toastOnExpectedError } from "@/api/refusals";
import { leagueQueryKey } from "@/api/leagues";

/**
 * Set (`amount`) or clear (`null`) the league's dues amount — ADR-0045. Dues
 * ride the league read (`duesAmount` on the league, `duesPaidAt` on each
 * member), so the one cache entry to refresh is the league's; the dashboard
 * summary doesn't carry dues.
 */
export function useUpdateLeagueDues(leagueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (amount: number | null) => {
      const { data, error, response } = await api.PUT("/api/leagues/{leagueId}/dues", {
        params: { path: { leagueId } },
        body: { amount },
      });
      if (error) {
        // The form validates the range before submitting, so a 400 here is a
        // stale client — the server's own wording says what it refused.
        toastOnExpectedError(error, response, (status) => status === 400);
        return null;
      }
      return data;
    },
    onSuccess: async (data, amount) => {
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
      if (data) toastSuccess(amount === null ? "Stopped tracking dues" : "Dues updated");
    },
    onError: () => toast.error("Couldn't update dues — please try again."),
  });
}

/**
 * Mark one member paid or unpaid. No success toast on purpose — like Promote
 * and Demote beside it, the row's refetched label is the acknowledgement.
 */
export function useUpdateMemberDues(leagueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, paid }: { memberId: string; paid: boolean }) => {
      const { error, response } = await api.PUT("/api/leagues/{leagueId}/dues/members/{memberId}", {
        params: { path: { leagueId, memberId } },
        body: { paid },
      });
      if (error) {
        // dues_not_enabled (409) means another commissioner turned dues off
        // under this view; member-not-found (404) that they were removed. Both
        // are phrased server-side, and the refetch below clears the stale row.
        toastOnExpectedError(error, response, (status) => status === 409 || status === 404);
        return null;
      }
      return true;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
    },
    onError: () => toast.error("Couldn't update that member's dues — please try again."),
  });
}
