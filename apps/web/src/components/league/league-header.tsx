import { Link } from "@tanstack/react-router";
import type { LeagueResponse } from "@picksleagues/schemas";
import { formatDateTime } from "@/lib/format";
import { leagueModeLabel, leagueModeRulesPath } from "@/lib/league";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/status-pill";

export function LeagueHeader({
  league,
  isCommissioner,
}: {
  league: LeagueResponse;
  isCommissioner: boolean;
}) {
  const rulesPath = leagueModeRulesPath(league.mode);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-xl">{league.name}</CardTitle>
            <CardDescription>
              {leagueModeLabel(league.mode)} · {league.seasonYear}
              {rulesPath && (
                <>
                  {" · "}
                  <Link to={rulesPath} className="underline hover:text-foreground">
                    Rules
                  </Link>
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill className="capitalize">{league.visibility}</StatusPill>
            {isCommissioner && <StatusPill tone="accent">Commissioner</StatusPill>}
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
