import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useMe } from "@/api/me";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/loading";
import { TabNav, tabLinkProps } from "@/components/tab-nav";

export const Route = createFileRoute("/_authed/admin")({
  component: AdminLayout,
});

/**
 * The admin surface's shell: one home for the `isAdmin` guard, so no child
 * route can be reached without it, and the tab bar the sections hang off.
 * Sections are routes rather than local tab state — each is deep-linkable
 * (a week's game slate is worth sharing while debugging a sync), survives a
 * refresh, and only the open section's queries run.
 */
function AdminLayout() {
  const me = useMe();

  if (me.isPending) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <PageSkeleton label="Loading" />
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

  if (!me.data.isAdmin) {
    // Admin surfaces are invisible to non-admins (engineering rules §Security)
    // — this reads identically to an unknown route, never an "admins only"
    // message, and never redirects (a redirect would confirm the route exists).
    return (
      <main className="flex flex-1 flex-col items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">Page not found.</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-foreground">Admin</h1>
      <TabNav label="Admin sections">
        <Link to="/admin" activeOptions={{ exact: true }} {...tabLinkProps}>
          Jobs
        </Link>
        <Link to="/admin/seasons" {...tabLinkProps}>
          Seasons
        </Link>
        <Link to="/admin/games" {...tabLinkProps}>
          Games
        </Link>
        <Link to="/admin/teams" {...tabLinkProps}>
          Teams
        </Link>
        <Link to="/admin/audit" {...tabLinkProps}>
          Audit
        </Link>
      </TabNav>
      <Outlet />
    </main>
  );
}
