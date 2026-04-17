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
import type { OddsWithContext } from "@/data/events";

import { EditOddsDialog } from "./edit-odds-dialog";
import { LockBadge } from "./lock-badge";
import { LockToggle } from "./lock-toggle";

function formatUtc(d: Date | null): string {
  if (!d) return "—";
  return formatInTimeZone(d, "UTC", "yyyy-MM-dd HH:mm 'UTC'");
}

function formatNumber(n: number | null, precision = 1): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(precision);
}

function formatMoneyline(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

export function OddsTable({ odds }: { odds: OddsWithContext[] }) {
  if (odds.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        No odds for this phase.
      </p>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Matchup</TableHead>
            <TableHead className="hidden sm:table-cell">Book</TableHead>
            <TableHead className="w-24 text-right">Home sprd</TableHead>
            <TableHead className="w-24 text-right">Away sprd</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {odds.map((row) => (
            <OddsRow key={row.id} row={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OddsRow({ row }: { row: OddsWithContext }) {
  const matchup = `${row.event.awayTeam.abbreviation} @ ${row.event.homeTeam.abbreviation}`;
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-mono text-xs font-semibold">{matchup}</span>
          <span className="sm:hidden text-xs text-muted-foreground">
            {row.sportsbook.name}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
        {row.sportsbook.name}
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatNumber(row.homeSpread)}
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatNumber(row.awaySpread)}
      </TableCell>
      <TableCell>
        <LockBadge lockedAt={row.lockedAt} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          <OddsDetailDialog row={row} matchup={matchup} />
          <EditOddsDialog row={row} />
          <LockToggle
            entity="odds"
            id={row.id}
            locked={!!row.lockedAt}
            label={`${matchup} (${row.sportsbook.name})`}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function OddsDetailDialog({
  row,
  matchup,
}: {
  row: OddsWithContext;
  matchup: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Details
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {matchup} — {row.sportsbook.name}
          </DialogTitle>
          <DialogDescription>
            Kickoff {formatUtc(row.event.startTime)}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <DetailRow label="Odds ID" value={row.id} mono />
          <DetailRow label="Event ID" value={row.eventId} mono />
          <DetailRow label="Home spread" value={formatNumber(row.homeSpread)} />
          <DetailRow label="Away spread" value={formatNumber(row.awaySpread)} />
          <DetailRow
            label="Home moneyline"
            value={formatMoneyline(row.homeMoneyline)}
          />
          <DetailRow
            label="Away moneyline"
            value={formatMoneyline(row.awayMoneyline)}
          />
          <DetailRow label="Over/under" value={formatNumber(row.overUnder)} />
          <DetailRow
            label="Locked"
            value={
              row.lockedAt ? (
                formatUtc(row.lockedAt)
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
