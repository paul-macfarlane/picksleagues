import { Link } from "@tanstack/react-router";
import type { LeagueResponse } from "@picksleagues/schemas";
import { useAppNow } from "@/lib/app-clock";
import { leagueModeLabel, leagueModeRulesPath, leagueTimingLine } from "@/lib/league";
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
  const now = useAppNow();
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
            <StatusPill>{league.visibility}</StatusPill>
            {isCommissioner && <StatusPill tone="strong">Commissioner</StatusPill>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>
          {league.members.length} member{league.members.length === 1 ? "" : "s"}
        </p>
        {/* No `currentWeekLabel` on this DTO — the week picker below names the
            week — so a started league here reads as a past-tense start date. */}
        <p>{leagueTimingLine(league, now)}</p>
      </CardContent>
    </Card>
  );
}
