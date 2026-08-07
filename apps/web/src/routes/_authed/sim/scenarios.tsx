import { createFileRoute } from "@tanstack/react-router";
import { SimReplayCard } from "@/components/sim/sim-replay-card";
import { SimScenariosCard } from "@/components/sim/sim-scenarios-card";
import { SimStateGate } from "@/components/sim/sim-state-gate";

/**
 * Import and library both live here: importing a replay season is how you get
 * a scenario to load, so the two belong on one page rather than split further.
 */
export const Route = createFileRoute("/_authed/sim/scenarios")({
  component: SimScenarios,
});

function SimScenarios() {
  return (
    <SimStateGate>
      {(state) => (
        <div className="flex flex-col gap-4">
          <SimScenariosCard state={state} />
          <SimReplayCard state={state} />
        </div>
      )}
    </SimStateGate>
  );
}
