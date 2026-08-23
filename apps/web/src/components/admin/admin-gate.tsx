import type { ReactNode } from "react";
import { useMe } from "@/api/me";
import type { MeResponse } from "@picksleagues/schemas";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/loading";

/**
 * The one home for the operator-surface guard, wrapped around every route
 * family only admins may see (Admin, Simulator, the guide). Refusal renders
 * as an unknown route — never an "admins only" message, never a redirect
 * (a redirect would confirm the route exists) — because admin surfaces are
 * invisible to non-admins (engineering rules §Security). `allow` tightens the
 * check where a surface needs more than the role: the simulator also needs
 * `simEnabled`, since `/api/sim/*` isn't registered without it (ADR-0011).
 */
export function AdminGate({
  allow = (me) => me.isAdmin,
  children,
}: {
  allow?: (me: MeResponse) => boolean;
  children: ReactNode;
}) {
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

  if (!allow(me.data)) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center py-8">
        {/* Testid'd because the guard tests' whole claim is that this reads as
            an unknown route — bound to the state, not to its sentence. */}
        <p data-testid="page-not-found" className="text-sm text-muted-foreground">
          Page not found.
        </p>
      </main>
    );
  }

  return <>{children}</>;
}
