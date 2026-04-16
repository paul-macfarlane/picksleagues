import type { Metadata } from "next";

import { AdvancePhaseButton } from "@/components/admin/simulator/advance-button";
import { InitializeSimulatorForm } from "@/components/admin/simulator/initialize-form";
import { ResetSimulatorDialog } from "@/components/admin/simulator/reset-dialog";
import { SimulatorStatusCard } from "@/components/admin/simulator/status-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSimulatorYearRange, getStatus } from "@/lib/simulator";

export const metadata: Metadata = {
  title: "Simulator",
};

export default async function SimulatorAdminPage() {
  const status = await getStatus();
  const { minYear, maxYear } = getSimulatorYearRange();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Simulator</h1>
        <p className="text-sm text-muted-foreground">
          Replay historical NFL seasons phase by phase to exercise sync, picks,
          and scoring flows without waiting for live games.
        </p>
      </header>

      <SimulatorStatusCard status={status} />

      <InitializeSimulatorForm currentYear={maxYear} minYear={minYear} />

      <Card>
        <CardHeader>
          <CardTitle>Advance</CardTitle>
          <CardDescription>
            Finalizes every event in the current phase and moves simNow into the
            next phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdvancePhaseButton
            disabled={!status.initialized || !status.currentPhase}
            currentPhaseLabel={status.currentPhase?.label ?? null}
          />
        </CardContent>
      </Card>

      <Card className="border-destructive/30 ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Reset</CardTitle>
          <CardDescription>
            Wipes simulator state and the simulated year&apos;s season data.
            Standings display is planned for a later story.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetSimulatorDialog disabled={!status.initialized} />
        </CardContent>
      </Card>
    </div>
  );
}
