import { createFileRoute } from "@tanstack/react-router";
import { SimFixturesCard } from "@/components/sim/sim-fixtures-card";
import { SimStateGate } from "@/components/sim/sim-state-gate";

export const Route = createFileRoute("/_authed/sim/fixtures")({
  component: SimFixtures,
});

function SimFixtures() {
  return <SimStateGate>{(state) => <SimFixturesCard state={state} />}</SimStateGate>;
}
