import { Badge } from "@/components/ui/badge";
import {
  formatLeagueRange,
  type LeagueRange,
  type LeagueSeasonState,
} from "@/lib/nfl/leagues";

const STATE_LABELS: Record<LeagueSeasonState, string> = {
  upcoming: "Upcoming",
  in_progress: "In progress",
  complete: "Complete",
};

const STATE_VARIANTS: Record<
  LeagueSeasonState,
  "default" | "secondary" | "outline"
> = {
  upcoming: "outline",
  in_progress: "default",
  complete: "secondary",
};

export function SeasonStateBadge({
  year,
  range,
  state,
}: {
  year: number;
  range: LeagueRange;
  state: LeagueSeasonState;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>
        {year} · {formatLeagueRange(range)}
      </span>
      <span aria-hidden>·</span>
      <Badge variant={STATE_VARIANTS[state]}>{STATE_LABELS[state]}</Badge>
    </div>
  );
}
