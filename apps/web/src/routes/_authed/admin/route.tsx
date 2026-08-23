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
 * guide is a standalone `/guide` route and the seasons browser is gone for
 * that reason (owner, 2026-08-22 — seasons were never consulted; the games
 * browser's week picker covers the question).
 */
function AdminLayout() {
  return (
    <AdminGate>
      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold text-foreground">Admin</h1>
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
          <Link to="/admin/audit" {...tabLinkProps}>
            Audit
          </Link>
        </TabNav>
        <Outlet />
      </main>
    </AdminGate>
  );
}
