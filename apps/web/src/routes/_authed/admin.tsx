import { createFileRoute } from "@tanstack/react-router";
import { useMe } from "@/api/me";
import { Button } from "@/components/ui/button";
import { SyncJobsCard } from "@/components/admin/sync-jobs-card";
import { TeamsBrowser } from "@/components/admin/teams-browser";
import { SeasonsBrowser } from "@/components/admin/seasons-browser";
import { GamesBrowser } from "@/components/admin/games-browser";

export const Route = createFileRoute("/_authed/admin")({
  component: Admin,
});

function Admin() {
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
      <SyncJobsCard />
      <SeasonsBrowser />
      <GamesBrowser />
      <TeamsBrowser />
    </main>
  );
}
