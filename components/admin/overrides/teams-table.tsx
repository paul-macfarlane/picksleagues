"use client";

import { useMemo, useState } from "react";

import { TeamLogo } from "@/components/team-logo";
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
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Team } from "@/lib/db/schema/sports";

import { DetailRow } from "./detail-row";
import { EditTeamDialog } from "./edit-team-dialog";
import { formatUtc } from "./format";
import { LockToggle } from "./lock-toggle";

export function TeamsTable({ teams }: { teams: Team[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.location.toLowerCase().includes(q) ||
        t.abbreviation.toLowerCase().includes(q),
    );
  }, [teams, query]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search by name, location, or abbreviation"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search teams"
      />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Abbr</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No teams match “{query}”.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((team) => <TeamRow key={team.id} team={team} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function TeamRow({ team }: { team: Team }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs font-semibold">
        {team.abbreviation}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <TeamLogo
            logoUrl={team.logoUrl}
            logoDarkUrl={team.logoDarkUrl}
            alt=""
            width={24}
            height={24}
            className="size-6 rounded-sm"
          />
          <div className="flex flex-col">
            <span className="font-medium">{team.name}</span>
            <span className="text-xs text-muted-foreground">
              {team.location}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          <TeamDetailDialog team={team} />
          <EditTeamDialog team={team} />
          <LockToggle
            entity="team"
            id={team.id}
            locked={!!team.lockedAt}
            label={team.abbreviation}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function TeamDetailDialog({ team }: { team: Team }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Details
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {team.location} {team.name}
          </DialogTitle>
          <DialogDescription>
            Team identifier: <span className="font-mono">{team.id}</span>
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <DetailRow label="Abbreviation" value={team.abbreviation} />
          <DetailRow label="Location" value={team.location} />
          <DetailRow label="Name" value={team.name} />
          <DetailRow
            label="Locked"
            value={
              team.lockedAt ? (
                formatUtc(team.lockedAt)
              ) : (
                <Badge variant="outline">No</Badge>
              )
            }
          />
          {team.logoUrl ? (
            <DetailRow label="Logo URL" value={team.logoUrl} mono />
          ) : null}
          {team.logoDarkUrl ? (
            <DetailRow label="Logo (dark)" value={team.logoDarkUrl} mono />
          ) : null}
        </dl>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
