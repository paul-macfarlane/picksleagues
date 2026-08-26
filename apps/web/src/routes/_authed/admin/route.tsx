import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AdminGate } from "@/components/admin/admin-gate";
import { TabNav, tabLinkProps } from "@/components/tab-nav";

export const Route = createFileRoute("/_authed/admin")({
  component: AdminLayout,
});

/**
 * The admin surface's shell: the guard wraps every child route, and the tab
 * bar the sections hang off. Sections are routes rather than local tab state
 * — each is deep-linkable (a week's game slate is worth sharing while
 * debugging a sync), survives a refresh, and only the open section's queries
 * run. Five tabs is the ceiling that fits a phone without scrolling; the
 * guide is a standalone `/guide` route linked from the heading and the
 * seasons browser is gone for that reason (owner, 2026-08-22 — seasons were
 * never consulted; the games browser's week picker covers the question). The
 * audit tab went with the override layer whose corrections it mostly recorded
 * (ADR-0046); rebuilds still write `admin_audit`, read with SQL.
 */
function AdminLayout() {
  return (
    <AdminGate>
      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl text-foreground">Admin</h1>
          {/* Same seat as the simulator's "How the simulator works": the guide
              is reached from the surface it explains, not from the app's
              primary nav (owner, 2026-08-22). */}
          <Link
            to="/guide"
            className="text-xs text-muted-foreground underline outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Admin guide
          </Link>
        </div>
        <TabNav label="Admin sections" fit>
          <Link to="/admin" activeOptions={{ exact: true }} {...tabLinkProps}>
            Jobs
          </Link>
          <Link to="/admin/games" {...tabLinkProps}>
            Games
          </Link>
          <Link to="/admin/teams" {...tabLinkProps}>
            Teams
          </Link>
          <Link to="/admin/stats" {...tabLinkProps}>
            Stats
          </Link>
        </TabNav>
        <Outlet />
      </main>
    </AdminGate>
  );
}
