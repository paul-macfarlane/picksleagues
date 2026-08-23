import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ERROR_CODE, type MeResponse, type UpdateMeRequest } from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { syncAppClock } from "@/lib/app-clock";

export const ME_QUERY_KEY = ["me"];

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/me");
      if (error) throw error;
      // The one place the browser's clock is a valid reference for the
      // server's: the response has just landed (arch D13, lib/app-clock).
      syncAppClock(data.now);
      return data;
    },
  });
}

/**
 * Shared by claim-username (first sign-in) and profile (anytime edit) — both
 * PATCH /api/me, but their 409 (username taken) and success behavior differ
 * entirely (claim navigates on, profile toasts + refetches), so the hook
 * stays thin and takes those as options rather than assuming a form or a
 * particular success action. 409 is field-level feedback, never a toast —
 * `onUsernameTaken` is the caller's `form.setErrorMap`, not moved in here.
 * The `/me` invalidation *is* in here: it is the fan-out every caller needs,
 * and a caller that forgets it renders a stale profile.
 */
export function useUpdateMe(options: {
  onUsernameTaken: () => void;
  onSuccess: (data: MeResponse) => void | Promise<void>;
  errorToastMessage: string;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateMeRequest) => {
      const { data, error, response } = await api.PATCH("/api/me", { body });
      if (data) syncAppClock(data.now);
      if (error) {
        if (response.status === 409) {
          options.onUsernameTaken();
          return null;
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await options.onSuccess(data);
    },
    onError: () => {
      toast.error(options.errorToastMessage);
    },
  });
}

const DELETION_BLOCKERS_QUERY_KEY = ["me", "deletion-blockers"];

/**
 * The leagues standing between the member and account deletion (ADR-0004) —
 * what lets the Danger Zone disable Delete with the reason *before* the
 * attempt, naming the leagues to hand off (FB-13). The server re-checks inside
 * the deletion transaction, so this failing open costs nothing but the nicer
 * message.
 */
export function useDeletionBlockers() {
  return useQuery({
    queryKey: DELETION_BLOCKERS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/me/deletion-blockers");
      if (error) throw error;
      return data;
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      // 204 has no body — success is "no error", not a `data` payload.
      const { error } = await api.DELETE("/api/me");
      if (error) throw error;
    },
    onSuccess: () => {
      // The account and every session are already gone server-side, so
      // there's nothing left for authClient.signOut() to revoke; clearing the
      // query cache drops every stale fetch, and /sign-in's beforeLoad
      // re-checks getSession() itself, which will find no session to bounce
      // back from.
      queryClient.clear();
      navigate({ to: "/sign-in" });
    },
    onError: (error) => {
      // The pre-click blockers read (FB-13) normally prevents this path, but it
      // can fail open or go stale — the refusal still deserves its real reason.
      toast.error(
        (error as { error?: string }).error === ERROR_CODE.LAST_COMMISSIONER
          ? "You're the only commissioner of a league that still has other members — promote another commissioner first."
          : "Couldn't delete your account — please try again.",
      );
    },
  });
}
