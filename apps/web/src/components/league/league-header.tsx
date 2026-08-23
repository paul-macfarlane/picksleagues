import { Link } from "@tanstack/react-router";
import type { LeagueResponse } from "@picksleagues/schemas";
import { useAppNow } from "@/lib/app-clock";
import { leagueModeLabel, leagueModeRulesPath, leagueTimingLine } from "@/lib/league";
import { Band } from "@/components/band";
import { StatusPill } from "@/components/status-pill";

/**
 * The league page's one band (ADR-0043 §2): the league is the subject of every
 * tab beneath it, so it is named on ink, in display type. The name is the
 * page's `h1` — the tabs below are sections of this one thing.
 */
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
    <Band>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="type-eyebrow">
            {leagueModeLabel(league.mode)} · {league.seasonYear}
            {rulesPath && (
              <>
                {" · "}
                <Link to={rulesPath} className="underline hover:text-foreground">
                  Rules
                </Link>
              </>
            )}
          </p>
          <h1 className="text-3xl break-words">{league.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill>{league.visibility}</StatusPill>
          {isCommissioner && <StatusPill tone="strong">Commissioner</StatusPill>}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <p>
          {league.members.length} member{league.members.length === 1 ? "" : "s"}
        </p>
        {/* No `currentWeekLabel` on this DTO — the week picker below names the
            week — so a started league here reads as a past-tense start date. */}
        <p>{leagueTimingLine(league, now)}</p>
      </div>
    </Band>
  );
}
