import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/app-header";
import { AppTabBar, appTabBarClearanceClassName } from "@/components/app-tab-bar";
import { LegalFooter } from "@/components/legal-footer";

/**
 * Pathless layout gating every signed-in route (mvp-spec has no anonymous browsing):
 * beforeLoad re-checks the session on every navigation into this subtree.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      // A bare "/" is a visitor at the front door, not a deep link — show the
      // splash (LNCH-11). Any deeper URL preserves the sign-in-and-return flow
      // (mvp-spec §Invites: "Visiting a link while signed out routes through
      // sign-in and back").
      if (location.pathname === "/") {
        throw redirect({ to: "/welcome" });
      }
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
    // First-time-only claim step per spec onboarding flow (OAuth → claim
    // username → dashboard): every route in this subtree stays gated until
    // claimed, then returns here via the preserved redirect.
    if (!session.user.username) {
      throw redirect({ to: "/claim-username", search: { redirect: location.href } });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <div className={cn("flex min-h-svh flex-col", appTabBarClearanceClassName)}>
      <AppHeader />
      {/* Every authed page inherits this one column — pages never set their own
          page width, only intentionally-narrow content (single-card states,
          forms) centered inside it. */}
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        <Outlet />
      </div>
      {/* Phones get these links in the profile's About section instead; under
          the tab bar a footer reads as stray content rather than chrome. */}
      <LegalFooter className="mx-auto hidden w-full max-w-5xl px-4 sm:flex sm:px-6" />
      <AppTabBar />
    </div>
  );
}
