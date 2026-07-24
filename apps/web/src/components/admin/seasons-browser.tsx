import { SPORT } from "@picksleagues/schemas";
import { useAdminSeasons } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { weekTypeLabel } from "@/lib/game";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminQueryState } from "@/components/admin/query-state";

export function SeasonsBrowser() {
  const seasons = useAdminSeasons(SPORT.NFL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seasons &amp; weeks</CardTitle>
        <CardDescription>Synced NFL seasons and their weeks.</CardDescription>
      </CardHeader>
      <CardContent>
        <AdminQueryState
          isPending={seasons.isPending}
          isError={seasons.isError}
          onRetry={() => seasons.refetch()}
          errorMessage="Couldn't load seasons."
          isEmpty={seasons.data?.seasons.length === 0}
          emptyMessage="No seasons synced yet."
        >
          <ul className="flex flex-col gap-4">
            {seasons.data?.seasons.map((season) => (
              <li
                key={season.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{season.year}</p>
                  {season.provisional && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      provisional
                    </span>
                  )}
                </div>
                {/* A provisional season exists before its structure is
                    ingested (ADR-0009), so an empty week list is expected
                    state, not an error. */}
                {season.weeks.length === 0 && (
                  <p className="text-xs text-muted-foreground">No weeks synced yet.</p>
                )}
                <ul className="flex flex-col gap-1.5">
                  {season.weeks.map((week) => (
                    <li
                      key={week.id}
                      className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-foreground">
                        {week.label}
                        <span className="text-muted-foreground">
                          {" "}
                          · {weekTypeLabel(week.weekType)}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        {formatDateTime(week.startsAt)} – {formatDateTime(week.endsAt)} ·{" "}
                        {/* A synced week with zero games is the sync-failure signal this
                            browser exists for (schema comment on AdminWeek.gameCount). */}
                        <span
                          className={
                            week.gameCount === 0
                              ? "font-medium text-destructive"
                              : "text-muted-foreground"
                          }
                        >
                          {week.gameCount} game{week.gameCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}
