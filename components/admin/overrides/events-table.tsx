"use client";

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
import type { EventWithTeams } from "@/data/events";
import type { ExternalEvent } from "@/lib/db/schema/external";
import type { Team } from "@/lib/db/schema/sports";

import { DetailRow } from "./detail-row";
import { EditEventDialog } from "./edit-event-dialog";
import { formatUtc } from "./format";
import { LockToggle } from "./lock-toggle";

function formatScore(home: number | null, away: number | null): string {
  if (home === null || away === null) return "—";
  return `${away}-${home}`;
}

export function EventsTable({
  events,
  externalEventMap,
  teams,
}: {
  events: EventWithTeams[];
  externalEventMap: Map<string, ExternalEvent>;
  teams: Team[];
}) {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        No events for this phase.
      </p>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Matchup</TableHead>
            <TableHead className="hidden sm:table-cell">Kickoff</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-20 text-right">Score</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              externalEvent={externalEventMap.get(event.id) ?? null}
              teams={teams}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EventRow({
  event,
  externalEvent,
  teams,
}: {
  event: EventWithTeams;
  externalEvent: ExternalEvent | null;
  teams: Team[];
}) {
  const matchupLabel = `${event.awayTeam.abbreviation} @ ${event.homeTeam.abbreviation}`;
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-mono text-xs font-semibold">
            {matchupLabel}
          </span>
          <span className="sm:hidden text-xs text-muted-foreground">
            {formatUtc(event.startTime)}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
        {formatUtc(event.startTime)}
      </TableCell>
      <TableCell>
        <StatusBadge status={event.status} />
      </TableCell>
      <TableCell className="text-right font-mono">
        {formatScore(event.homeScore, event.awayScore)}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          <EventDetailDialog
            event={event}
            externalEvent={externalEvent}
            matchupLabel={matchupLabel}
          />
          <EditEventDialog event={event} teams={teams} />
          <LockToggle
            entity="event"
            id={event.id}
            locked={!!event.lockedAt}
            label={matchupLabel}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: EventWithTeams["status"] }) {
  const variant =
    status === "final"
      ? "default"
      : status === "in_progress"
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}

function EventDetailDialog({
  event,
  externalEvent,
  matchupLabel,
}: {
  event: EventWithTeams;
  externalEvent: ExternalEvent | null;
  matchupLabel: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Details
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{matchupLabel}</DialogTitle>
          <DialogDescription>
            {event.awayTeam.location} {event.awayTeam.name} at{" "}
            {event.homeTeam.location} {event.homeTeam.name}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <DetailRow label="Event ID" value={event.id} mono />
          <DetailRow label="Phase ID" value={event.phaseId} mono />
          <DetailRow label="Kickoff" value={formatUtc(event.startTime)} />
          <DetailRow label="Status" value={event.status.replace("_", " ")} />
          <DetailRow
            label="Score"
            value={formatScore(event.homeScore, event.awayScore)}
          />
          <DetailRow
            label="Period"
            value={event.period === null ? "—" : String(event.period)}
          />
          <DetailRow label="Clock" value={event.clock ?? "—"} />
          <DetailRow
            label="Locked"
            value={
              event.lockedAt ? (
                formatUtc(event.lockedAt)
              ) : (
                <Badge variant="outline">No</Badge>
              )
            }
          />
        </dl>
        {externalEvent ? (
          <dl className="grid grid-cols-1 gap-2 border-t pt-3 text-xs text-muted-foreground">
            <DetailRow
              label="ESPN external id"
              value={externalEvent.externalId}
              mono
            />
            {externalEvent.statusRef ? (
              <DetailRow
                label="Status ref"
                value={externalEvent.statusRef}
                mono
              />
            ) : null}
            {externalEvent.oddsRef ? (
              <DetailRow label="Odds ref" value={externalEvent.oddsRef} mono />
            ) : null}
          </dl>
        ) : null}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
