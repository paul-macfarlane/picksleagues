import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { MeResponse, UpdateMeRequest } from "@picksleagues/schemas";
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

// Shared by claim-username (first sign-in) and profile (anytime edit) — both
// PATCH /api/me, but their 409 (username taken) and success behavior differ
// entirely (claim navigates on, profile toasts + refetches), so the hook
// stays thin and takes those as options rather than assuming a form or a
// particular success action. 409 is field-level feedback, never a toast —
// `onUsernameTaken` is the caller's `form.setErrorMap`, not moved in here.
export function useUpdateMe(options: {
  onUsernameTaken: () => void;
  onSuccess: (data: MeResponse) => void | Promise<void>;
  errorToastMessage: string;
}) {
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
      await options.onSuccess(data);
    },
    onError: () => {
      toast.error(options.errorToastMessage);
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
    onError: () => {
      toast.error("Couldn't delete your account — please try again.");
    },
  });
}
