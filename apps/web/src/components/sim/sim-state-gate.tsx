import type { ReactNode } from "react";
import type { SimStateResponse } from "@picksleagues/schemas";
import { useSimState } from "@/api/sim";
import { QueryState } from "@/components/query-state";

/**
 * One `useSimState` query per simulator page. The pages are sibling routes, so
 * only one gate is ever mounted at a time — the observer this actually shares a
 * cache entry with is `SimClockBanner`, which the authed shell mounts on every
 * page for a sim-enabled admin. react-query dedupes them by query key, which is
 * why the state isn't threaded through router context instead.
 */
export function SimStateGate({ children }: { children: (state: SimStateResponse) => ReactNode }) {
  const state = useSimState();

  return (
    <QueryState
      isPending={state.isPending}
      isError={state.isError}
      onRetry={() => state.refetch()}
      errorMessage="Couldn't load the simulator."
    >
      {/* QueryState's children are evaluated by the parent regardless of its
          own pending/error guards, so `data` still needs its own guard here. */}
      {state.data && children(state.data)}
    </QueryState>
  );
}
