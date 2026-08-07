import { createFileRoute } from "@tanstack/react-router";
import { SimResetCard } from "@/components/sim/sim-reset-card";

/**
 * Takes no props and needs no sim-state gate: the reset controls only need
 * the operator's own leagues (useMyLeagues), not the simulator snapshot.
 */
export const Route = createFileRoute("/_authed/sim/reset")({
  component: SimReset,
});

function SimReset() {
  return <SimResetCard />;
}
