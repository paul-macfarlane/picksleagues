import { Link } from "@tanstack/react-router";
import type { LeagueResponse } from "@picksleagues/schemas";
import { useAppNow } from "@/lib/app-clock";
import { leagueModeLabel, leagueModeRulesPath, leagueTimingLine } from "@/lib/league";
import { Band } from "@/components/band";
import { LeagueStanding } from "@/components/league/league-standing";
import { StatusPill } from "@/components/status-pill";

/**
 * The league page's one band (ADR-0043 §2): the league is the subject of every
 * tab beneath it, so it is named on ink, in display type, with the viewer's
 * own standing beside it as the band's numerals. The name is the page's `h1` —
 * the tabs below are sections of this one thing.
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
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
          <h1 className="text-3xl break-words sm:text-4xl">{league.name}</h1>
        </div>
        <LeagueStanding
          className="shrink-0"
          league={{ ...league, memberCount: league.members.length }}
          now={now}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        <StatusPill>{league.visibility}</StatusPill>
        {isCommissioner && <StatusPill tone="strong">Commissioner</StatusPill>}
        {/* No `currentWeekLabel` on this DTO — the week picker below names the
            week — so a started league here reads as a past-tense start date. */}
        <p>{leagueTimingLine(league, now)}</p>
      </div>
    </Band>
  );
}
