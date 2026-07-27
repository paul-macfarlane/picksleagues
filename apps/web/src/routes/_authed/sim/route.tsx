import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useMe } from "@/api/me";
import { Button } from "@/components/ui/button";
import { TabNav, tabLinkProps } from "@/components/tab-nav";

export const Route = createFileRoute("/_authed/sim")({
  component: SimLayout,
});

/**
 * The simulator's shell: its own top-level section (SIM-9 — human's explicit
 * decision, not a tab under Admin), one home for the guard so no child route
 * can be reached without it, and the tab bar the sections hang off. Sections
 * are routes rather than local tab state — each is deep-linkable and survives
 * a refresh, and only the open section's queries run (same rationale as the
 * admin layout route this mirrors).
 */
function SimLayout() {
  const me = useMe();

  if (me.isPending) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (me.isError || !me.data) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this page.</p>
        <Button variant="outline" onClick={() => me.refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  // Doubled on purpose: the layout proves admin *and* that this environment
  // has a simulator at all — `/api/sim/*` isn't registered when
  // `isSimEnabled` is false (ADR-0011/ADR-0014) — so a sim-less environment
  // must read identically to an unknown route, never an "unavailable"
  // message, and never a redirect (a redirect would confirm the route exists).
  if (!me.data.isAdmin || !me.data.simEnabled) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">Page not found.</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-foreground">Simulator</h1>
      <TabNav label="Simulator sections">
        <Link to="/sim" activeOptions={{ exact: true }} {...tabLinkProps}>
          Clock
        </Link>
        <Link to="/sim/scenarios" {...tabLinkProps}>
          Scenarios
        </Link>
        <Link to="/sim/fixtures" {...tabLinkProps}>
          Fixtures
        </Link>
        <Link to="/sim/reset" {...tabLinkProps}>
          Reset
        </Link>
      </TabNav>
      <Outlet />
    </main>
  );
}
