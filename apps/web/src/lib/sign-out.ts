import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";

/**
 * The one sign-out, shared by the header's account menu and the profile
 * page's Account section. Navigates regardless of the result: /sign-in's
 * beforeLoad bounces a still-live session back to "/", so a failed sign-out
 * can't strand the member on a page they shouldn't see.
 */
export function useSignOut() {
  const navigate = useNavigate();
  return async () => {
    const { error } = await authClient.signOut();
    if (error) {
      console.error("Sign-out failed", error);
      toast.error("Sign out failed — please try again.");
    }
    await navigate({ to: "/sign-in" });
  };
}
