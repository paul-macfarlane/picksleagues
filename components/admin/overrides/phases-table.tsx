"use client";

import { formatInTimeZone } from "date-fns-tz";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Phase } from "@/lib/db/schema/sports";

import { EditPhaseDialog } from "./edit-phase-dialog";
import { LockBadge } from "./lock-badge";
import { LockToggle } from "./lock-toggle";

function formatUtc(d: Date | null): string {
  if (!d) return "—";
  return formatInTimeZone(d, "UTC", "yyyy-MM-dd HH:mm 'UTC'");
}

export function PhasesTable({ phases }: { phases: Phase[] }) {
  if (phases.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        No phases for this season.
      </p>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Wk</TableHead>
            <TableHead>Label</TableHead>
            <TableHead className="hidden sm:table-cell">Window</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {phases.map((phase) => (
            <PhaseRow key={phase.id} phase={phase} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PhaseRow({ phase }: { phase: Phase }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{phase.weekNumber}</TableCell>
      <TableCell className="font-medium">{phase.label}</TableCell>
      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
        {formatUtc(phase.startDate)} → {formatUtc(phase.endDate)}
      </TableCell>
      <TableCell>
        <LockBadge lockedAt={phase.lockedAt} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          <PhaseDetailDialog phase={phase} />
          <EditPhaseDialog phase={phase} />
          <LockToggle
            entity="phase"
            id={phase.id}
            locked={!!phase.lockedAt}
            label={phase.label}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function PhaseDetailDialog({ phase }: { phase: Phase }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Details
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{phase.label}</DialogTitle>
          <DialogDescription>
            Week {phase.weekNumber} · {phase.seasonType}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <DetailRow label="Phase ID" value={phase.id} mono />
          <DetailRow label="Season ID" value={phase.seasonId} mono />
          <DetailRow label="Starts" value={formatUtc(phase.startDate)} />
          <DetailRow label="Ends" value={formatUtc(phase.endDate)} />
          <DetailRow label="Pick lock" value={formatUtc(phase.pickLockTime)} />
          <DetailRow
            label="Locked"
            value={
              phase.lockedAt ? (
                formatUtc(phase.lockedAt)
              ) : (
                <Badge variant="outline">No</Badge>
              )
            }
          />
        </dl>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "break-all font-mono text-xs" : undefined}>
        {value}
      </dd>
    </div>
  );
}
