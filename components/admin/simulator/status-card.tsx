import { formatInTimeZone } from "date-fns-tz";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SimulatorStatus } from "@/lib/simulator";

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return formatInTimeZone(d, "UTC", "yyyy-MM-dd HH:mm:ss 'UTC'");
}

export function SimulatorStatusCard({ status }: { status: SimulatorStatus }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Status</CardTitle>
          <Badge variant={status.initialized ? "default" : "secondary"}>
            {status.initialized ? "Active" : "Idle"}
          </Badge>
        </div>
        <CardDescription>
          {status.initialized
            ? `Simulating season ${status.seasonYear}.`
            : "No simulation active."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <StatusRow label="Sim now" value={formatDate(status.simNow)} />
          <StatusRow
            label="Phases"
            value={status.totalPhases > 0 ? String(status.totalPhases) : "—"}
          />
          <StatusRow
            label="Events finalized"
            value={
              status.totalEvents > 0
                ? `${status.finalizedEvents} / ${status.totalEvents}`
                : "—"
            }
          />
          <StatusRow
            label="Current phase"
            value={status.currentPhase?.label ?? "—"}
          />
        </dl>

        {status.currentPhase && (
          <div className="rounded-md border border-border/50 bg-muted/30 p-3">
            <div className="font-medium">{status.currentPhase.label}</div>
            <div className="mt-1 text-muted-foreground">
              {formatDate(status.currentPhase.startDate)} →{" "}
              {formatDate(status.currentPhase.endDate)}
            </div>
            <div className="mt-2">
              {status.currentPhase.eventsFinalized} /{" "}
              {status.currentPhase.eventsTotal} events finalized
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
