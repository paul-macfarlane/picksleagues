import type { LeagueStanding } from "@/lib/db/schema/leagues";
import { formatPoints } from "@/lib/nfl/scoring";

export function MyPicksHeader({
  standing,
  memberCount,
}: {
  standing: LeagueStanding | null;
  memberCount: number;
}) {
  const rank = standing?.rank ?? 1;
  const wins = standing?.wins ?? 0;
  const losses = standing?.losses ?? 0;
  const pushes = standing?.pushes ?? 0;
  const points = standing?.points ?? 0;

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Rank
        </span>
        <span className="text-2xl font-bold tabular-nums">
          {rank}
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            of {memberCount}
          </span>
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Record
        </span>
        <span className="text-sm font-medium tabular-nums">
          {wins}-{losses}
          {pushes > 0 ? `-${pushes}` : ""}
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Points
        </span>
        <span className="text-2xl font-bold tabular-nums">
          {formatPoints(points)}
        </span>
      </div>
    </section>
  );
}
