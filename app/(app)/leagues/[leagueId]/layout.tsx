import { notFound } from "next/navigation";

import { LeagueAvatar } from "@/components/leagues/league-avatar";
import { LeagueTabs } from "@/components/leagues/league-tabs";
import { SeasonStateBadge } from "@/components/leagues/season-state-badge";
import { getLeagueById } from "@/data/leagues";
import { getLeagueMember } from "@/data/members";
import { getPhasesBySeason } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSession } from "@/lib/auth";
import { getLeagueSeasonState, selectCurrentSeason } from "@/lib/nfl/leagues";
import { getAppNow } from "@/lib/simulator";

export default async function LeagueLayout({
  children,
  params,
}: LayoutProps<"/leagues/[leagueId]">) {
  const { leagueId } = await params;
  const session = await getSession();
  const league = await getLeagueById(leagueId);
  if (!league) {
    notFound();
  }
  // Treat non-members as "page doesn't exist" rather than throwing a
  // ForbiddenError — we don't want random users to be able to probe
  // league IDs, and the 404 path avoids dumping a scary error boundary.
  const member = await getLeagueMember(leagueId, session.user.id);
  if (!member) {
    notFound();
  }

  const now = await getAppNow();
  const seasons = await getSeasonsBySportsLeague(league.sportsLeagueId);
  const currentSeason = selectCurrentSeason(seasons, now);
  const phases = currentSeason ? await getPhasesBySeason(currentSeason.id) : [];
  const seasonState = currentSeason
    ? getLeagueSeasonState(phases, league.seasonFormat, now)
    : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4">
      <header className="flex items-center gap-3">
        <LeagueAvatar name={league.name} imageUrl={league.imageUrl} size="md" />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {league.name}
          </h1>
          {currentSeason && seasonState ? (
            <SeasonStateBadge
              year={currentSeason.year}
              format={league.seasonFormat}
              state={seasonState}
            />
          ) : null}
        </div>
      </header>
      <LeagueTabs leagueId={leagueId} />
      {children}
    </div>
  );
}
