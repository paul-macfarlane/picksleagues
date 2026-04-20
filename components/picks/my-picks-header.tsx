import type { LeagueStanding } from "@/lib/db/schema/leagues";
import { formatPoints } from "@/lib/nfl/scoring";

export interface StandingSummary {
  rank: number;
  wins: number;
  losses: number;
  pushes: number;
  points: number;
}

export function MyPicksHeader({
  standing,
  weekly,
  memberCount,
}: {
  standing: LeagueStanding | null;
  weekly: StandingSummary | null;
  memberCount: number;
}) {
  const overall: StandingSummary = {
    rank: standing?.rank ?? 1,
    wins: standing?.wins ?? 0,
    losses: standing?.losses ?? 0,
    pushes: standing?.pushes ?? 0,
    points: standing?.points ?? 0,
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3">
      <StandingsRow
        label="Overall"
        summary={overall}
        memberCount={memberCount}
      />
      {weekly ? (
        <StandingsRow
          label="This Week"
          summary={weekly}
          memberCount={memberCount}
        />
      ) : null}
    </section>
  );
}

function StandingsRow({
  label,
  summary,
  memberCount,
}: {
  label: string;
  summary: StandingSummary;
  memberCount: number;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr_auto_auto] items-baseline gap-x-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-bold tabular-nums">
        #{summary.rank}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          of {memberCount}
        </span>
      </span>
      <span className="text-sm tabular-nums text-muted-foreground">
        {summary.wins}-{summary.losses}-{summary.pushes}
      </span>
      <span className="text-lg font-bold tabular-nums">
        {formatPoints(summary.points)}
      </span>
    </div>
  );
}
