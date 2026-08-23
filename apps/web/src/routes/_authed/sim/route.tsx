import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AdminGate } from "@/components/admin/admin-gate";
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
 * admin layout route this mirrors). `AdminGate` owns the guard.
 */
function SimLayout() {
  // Doubled on purpose: the layout proves admin *and* that this environment
  // has a simulator at all — `/api/sim/*` isn't registered when
  // `isSimEnabled` is false (ADR-0011/ADR-0014) — so a sim-less environment
  // must read identically to an unknown route.
  return (
    <AdminGate allow={(me) => me.isAdmin && Boolean(me.simEnabled)}>
      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl text-foreground">Simulator</h1>
          {/* New tab like the pick sheets' rules links: the guide is the page an
            operator sends a tester mid-drive, and losing the sim page to read
            it would lose the state being demonstrated. */}
          <Link
            to="/rules/simulator"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            How the simulator works
          </Link>
        </div>
        <TabNav label="Simulator sections" fit>
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
    </AdminGate>
  );
}
