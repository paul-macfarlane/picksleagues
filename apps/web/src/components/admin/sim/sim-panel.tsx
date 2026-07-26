import { useSimState } from "@/api/sim";
import { AdminQueryState } from "@/components/admin/query-state";
import { SimClockCard } from "@/components/admin/sim/sim-clock-card";
import { SimReplayCard } from "@/components/admin/sim/sim-replay-card";
import { SimResetCard } from "@/components/admin/sim/sim-reset-card";
import { SimScenariosCard } from "@/components/admin/sim/sim-scenarios-card";

// One `useSimState` query for the whole panel — every card reads the same
// snapshot as a prop rather than each issuing its own request, so the clock,
// scenario list, and active-scenario marker can never disagree within a
// render.
export function SimPanel() {
  const state = useSimState();

  const data = state.data;

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
      {data && (
        <div className="flex flex-col gap-4">
          <SimClockCard state={data} />
          <SimScenariosCard state={data} />
          <SimReplayCard state={data} />
          <SimResetCard />
        </div>
      )}
    </AdminQueryState>
  );
}
