import type { ReactNode } from "react";
import type { SimStateResponse } from "@picksleagues/schemas";
import { useSimState } from "@/api/sim";
import { AdminQueryState } from "@/components/admin/query-state";

// One `useSimState` query shared by every simulator page (SIM-9 split the
// panel into its own top-level section, one route per card) — react-query
// dedupes by query key, so four pages each mounting this gate still issues a
// single request; that dedup is exactly why the state isn't threaded through
// router context instead.
export function SimStateGate({ children }: { children: (state: SimStateResponse) => ReactNode }) {
  const state = useSimState();

  return (
    <AdminQueryState
      isPending={state.isPending}
      isError={state.isError}
      onRetry={() => state.refetch()}
      errorMessage="Couldn't load the simulator."
    >
      {/* AdminQueryState's children are evaluated by the parent regardless
          of its own pending/error guards, so `data` still needs its own
          guard here. */}
      {state.data && children(state.data)}
    </AdminQueryState>
  );
}
