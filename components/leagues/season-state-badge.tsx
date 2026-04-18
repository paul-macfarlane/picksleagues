import { Badge } from "@/components/ui/badge";
import type { SeasonFormat } from "@/lib/db/schema/leagues";
import type { LeagueSeasonState } from "@/lib/nfl/leagues";
import { SEASON_FORMAT_LABELS } from "@/lib/validators/leagues";

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
  format,
  state,
}: {
  year: number;
  format: SeasonFormat;
  state: LeagueSeasonState;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>
        {year} {SEASON_FORMAT_LABELS[format]}
      </span>
      <span aria-hidden>·</span>
      <Badge variant={STATE_VARIANTS[state]}>{STATE_LABELS[state]}</Badge>
    </div>
  );
}
