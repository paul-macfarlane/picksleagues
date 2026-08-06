import { createFileRoute } from "@tanstack/react-router";
import { SimClockCard } from "@/components/sim/sim-clock-card";
import { SimStateGate } from "@/components/sim/sim-state-gate";

/**
 * The default simulator section: what every "now" read resolves to (arch D13).
 */
export const Route = createFileRoute("/_authed/sim/")({
  component: SimClock,
});

function SimClock() {
  return <SimStateGate>{(state) => <SimClockCard state={state} />}</SimStateGate>;
}
