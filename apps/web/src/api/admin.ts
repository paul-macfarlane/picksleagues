import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { NflSyncJob } from "@picksleagues/schemas";
import { api } from "@/lib/api";

// Each job row mounts its own instance and scopes pending state off
// `mutation.variables` (async-button standard). No query invalidation: the
// admin page doesn't read any game-data query the jobs would affect.
export function useRunNflSyncJob() {
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
    onSuccess: (data) => {
      if (!data) return;
      toast.success(`Ran ${data.job} in ${data.durationMs}ms`);
    },
    onError: () => toast.error("Job failed — check the server logs."),
  });
}
