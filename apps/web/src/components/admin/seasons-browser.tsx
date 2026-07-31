import { Link } from "@tanstack/react-router";
import { SPORT, type AdminSeason } from "@picksleagues/schemas";
import { useAdminSeasons } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { weekTypeLabel } from "@/lib/game";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/query-state";

export function SeasonsBrowser() {
  const seasons = useAdminSeasons(SPORT.NFL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seasons &amp; weeks</CardTitle>
        <CardDescription>
          Synced NFL seasons and their weeks. A week with no games is a sync that didn&apos;t finish
          — open it to see the slate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          isPending={seasons.isPending}
          isError={seasons.isError}
          onRetry={() => seasons.refetch()}
          errorMessage="Couldn't load seasons."
          isEmpty={seasons.data?.seasons.length === 0}
          emptyMessage="No seasons synced yet."
        >
          <ul className="flex flex-col gap-4">
            {seasons.data?.seasons.map((season, index) => (
              <li key={season.id}>
                {/* Every season carries ~22 weeks, so only the newest opens by
                    default — past seasons stay one click away rather than
                    burying the current one under a season of scroll. */}
                <SeasonSection season={season} defaultOpen={index === 0} />
              </li>
            ))}
          </ul>
        </QueryState>
      </CardContent>
    </Card>
  );
}

function SeasonSection({ season, defaultOpen }: { season: AdminSeason; defaultOpen: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-border p-3">
      <summary className="flex cursor-pointer items-center gap-2 select-none">
        <span className="text-sm font-medium text-foreground">{season.year}</span>
        {season.provisional && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            provisional
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {season.weeks.length} week{season.weeks.length === 1 ? "" : "s"}
        </span>
      </summary>

      {/* A provisional season exists before its structure is ingested
          (ADR-0009), so an empty week list is expected state, not an error. */}
      {season.weeks.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">No weeks synced yet.</p>
      )}

      <ul className="mt-2 flex flex-col gap-1.5">
        {season.weeks.map((week) => (
          <li key={week.id}>
            <Link
              to="/admin/games"
              search={{ weekId: week.id }}
              className="flex flex-col gap-0.5 rounded-md px-1 py-0.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-foreground">
                {week.label}
                <span className="text-muted-foreground"> · {weekTypeLabel(week.weekType)}</span>
              </span>
              <span className="text-muted-foreground">
                {formatDateTime(week.startsAt)} – {formatDateTime(week.endsAt)} ·{" "}
                {/* A synced week with zero games is the sync-failure signal this
                    browser exists for (schema comment on AdminWeek.gameCount). */}
                <span
                  className={
                    week.gameCount === 0 ? "font-medium text-destructive" : "text-muted-foreground"
                  }
                >
                  {week.gameCount} game{week.gameCount === 1 ? "" : "s"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
