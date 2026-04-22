import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeagueStandingWithProfile } from "@/data/standings";
import { formatPoints, type StandingsDelta } from "@/lib/nfl/scoring";
import { cn, getInitials } from "@/lib/utils";

export function StandingsTable({
  standings,
  deltas,
  viewerUserId,
}: {
  standings: LeagueStandingWithProfile[];
  deltas?: ReadonlyMap<string, StandingsDelta>;
  viewerUserId: string;
}) {
  if (standings.length === 0) {
    return (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No standings yet. Points show up once picks start scoring.
        </p>
      </section>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="text-right tabular-nums">Pts</TableHead>
            <TableHead className="text-right tabular-nums">W-L-P</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((standing) => {
            const isViewer = standing.userId === viewerUserId;
            const delta = deltas?.get(standing.userId);
            return (
              <TableRow
                key={standing.id}
                className={isViewer ? "bg-primary/5" : undefined}
              >
                <TableCell className="font-semibold tabular-nums">
                  <div className="flex flex-col items-start gap-0.5">
                    <span>{standing.rank}</span>
                    {delta ? <RankDelta delta={delta.delta} /> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      {standing.profile.avatarUrl ? (
                        <AvatarImage src={standing.profile.avatarUrl} alt="" />
                      ) : null}
                      <AvatarFallback>
                        {getInitials(standing.profile.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {standing.profile.name}
                        {isViewer ? " (you)" : ""}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        @{standing.profile.username}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right text-base font-semibold tabular-nums">
                  {formatPoints(standing.points)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {standing.wins}-{standing.losses}-{standing.pushes}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RankDelta({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <Minus
        aria-label="Rank unchanged"
        className="size-3 text-muted-foreground"
      />
    );
  }
  const Icon = delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      aria-label={`Rank ${delta > 0 ? "up" : "down"} ${Math.abs(delta)}`}
      className={cn(
        "flex items-center gap-0.5 text-xs font-medium tabular-nums",
        delta > 0 ? "text-green-500" : "text-red-500",
      )}
    >
      <Icon className="size-3" />
      {Math.abs(delta)}
    </span>
  );
}
