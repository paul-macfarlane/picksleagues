import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ERROR_CODE, type UpdateLeagueRequest } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { leagueQueryKey } from "@/components/league/query-key";

// One `useMutation` per editor (not one shared instance) — each editor needs
// its OWN `isPending` so submitting one save button doesn't disable the
// others (async-button standard: a save button disables only for its own
// in-flight save). All editors share this mutationFn/invalidation.
export function useUpdateLeagueMutation(leagueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateLeagueRequest) => {
      const { data, error, response } = await api.PATCH("/api/leagues/{leagueId}", {
        params: { path: { leagueId } },
        body,
      });
      if (error) {
        // maxMembers dropped below the current member count gets its own
        // clear copy rather than the generic message — mapped off the wire
        // error slug, never an inline string comparison.
        if (response.status === 409 && error.error === ERROR_CODE.MAX_MEMBERS_BELOW_MEMBER_COUNT) {
          toast.error("Can't set the cap below the current member count.");
          return null;
        }
        // league_started (409) or a settings shape that fails the mode's
        // schema (400) are both server-derived refusals — surface the exact
        // message, don't throw.
        if (response.status === 409 || response.status === 400) {
          toast.error(error.message);
          return null;
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      // Renames show on the dashboard card too.
      await queryClient.invalidateQueries({ queryKey: leagueQueryKey(leagueId) });
      await queryClient.invalidateQueries({ queryKey: ["my-leagues"] });
      if (data) toast.success("League updated");
    },
    onError: () => toast.error("Couldn't update this league — please try again."),
  });
}
