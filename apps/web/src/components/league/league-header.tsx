import type { LeagueResponse } from "@picksleagues/schemas";
import { formatDateTime } from "@/lib/format";
import { leagueModeLabel } from "@/lib/league";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LeagueHeader({
  league,
  isCommissioner,
}: {
  league: LeagueResponse;
  isCommissioner: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-xl">{league.name}</CardTitle>
            <CardDescription>
              {leagueModeLabel(league.mode)} · {league.seasonYear}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
              {league.visibility}
            </span>
            {isCommissioner && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Commissioner
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>
          {league.members.length} member{league.members.length === 1 ? "" : "s"}
        </p>
        <p>{league.startsAt ? `Starts ${formatDateTime(league.startsAt)}` : "Start date TBD"}</p>
      </CardContent>
    </Card>
  );
}
