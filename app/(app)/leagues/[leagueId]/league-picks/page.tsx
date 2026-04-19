import { notFound } from "next/navigation";

import { MemberPicksCard } from "@/components/picks/member-picks-card";
import { PhaseNavigation } from "@/components/picks/phase-navigation";
import { PickLockBanner } from "@/components/picks/pick-lock-banner";
import {
  getEventsByPhaseWithTeams,
  getOddsForEventsWithSportsbook,
  indexPrimaryOddsByEvent,
} from "@/data/events";
import { getLeagueById } from "@/data/leagues";
import { getPhasesBySeason } from "@/data/phases";
import { getPicksForLeaguePhaseAllMembers } from "@/data/picks";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getStandingsForLeagueSeasonWithProfiles } from "@/data/standings";
import { getSession } from "@/lib/auth";
import type { League } from "@/lib/db/schema/leagues";
import {
  isPhaseLocked,
  phaseLabel,
  resolvePhaseView,
  selectCurrentSeason,
} from "@/lib/nfl/leagues";
import { getAppNow } from "@/lib/simulator";

export default async function LeaguePicksPage(
  props: PageProps<"/leagues/[leagueId]/league-picks">,
) {
  const { leagueId } = await props.params;
  const searchParams = await props.searchParams;
  const requestedPhaseId =
    typeof searchParams.phase === "string" ? searchParams.phase : null;

  const league = await getLeagueById(leagueId);
  if (!league) notFound();

  const now = await getAppNow();
  const seasons = await getSeasonsBySportsLeague(league.sportsLeagueId);
  const currentSeason = selectCurrentSeason(seasons, now);
  if (!currentSeason) {
    return <EmptyState message="No season data available yet." />;
  }

  const allPhases = await getPhasesBySeason(currentSeason.id);
  const resolved = resolvePhaseView({
    league,
    allPhases,
    requestedPhaseId,
    now,
  });
  if (resolved.kind === "no-phases-in-range") {
    return (
      <EmptyState message="This league's schedule range has no synced phases yet." />
    );
  }
  const { selectedPhase, prevPhase, nextPhase } = resolved;

  const phaseLocked = isPhaseLocked(selectedPhase, now);

  return (
    <div className="flex flex-col gap-4">
      <PhaseNavigation
        basePath={`/leagues/${leagueId}/league-picks`}
        currentPhase={selectedPhase}
        prevPhase={prevPhase}
        nextPhase={nextPhase}
      />
      <PickLockBanner
        pickLockTime={selectedPhase.pickLockTime}
        isLocked={phaseLocked}
      />
      {!phaseLocked ? (
        <EmptyState
          message={`League picks will be visible after the ${phaseLabel(
            selectedPhase.seasonType,
            selectedPhase.weekNumber,
          )} deadline.`}
        />
      ) : (
        <LockedPhaseContent
          leagueId={leagueId}
          league={league}
          selectedPhaseId={selectedPhase.id}
          currentSeasonId={currentSeason.id}
        />
      )}
    </div>
  );
}

async function LockedPhaseContent({
  leagueId,
  league,
  selectedPhaseId,
  currentSeasonId,
}: {
  leagueId: string;
  league: Pick<League, "pickType">;
  selectedPhaseId: string;
  currentSeasonId: string;
}) {
  const session = await getSession();
  const viewerUserId = session.user.id;
  const events = await getEventsByPhaseWithTeams(selectedPhaseId);
  const [picks, standings, oddsRows] = await Promise.all([
    getPicksForLeaguePhaseAllMembers(leagueId, selectedPhaseId),
    getStandingsForLeagueSeasonWithProfiles(leagueId, currentSeasonId),
    getOddsForEventsWithSportsbook(events.map((e) => e.id)),
  ]);

  const oddsByEventId = indexPrimaryOddsByEvent(oddsRows);

  const picksByUserId = new Map<string, typeof picks>();
  for (const pick of picks) {
    const existing = picksByUserId.get(pick.userId) ?? [];
    existing.push(pick);
    picksByUserId.set(pick.userId, existing);
  }

  if (standings.length === 0) {
    return (
      <EmptyState message="No members have standings yet for this season." />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {standings.map((standing) => (
        <li key={standing.id}>
          <MemberPicksCard
            standing={standing}
            picks={picksByUserId.get(standing.userId) ?? []}
            events={events}
            oddsByEventId={oddsByEventId}
            pickType={league.pickType}
            isViewer={standing.userId === viewerUserId}
            defaultOpen={standing.userId === viewerUserId}
          />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </section>
  );
}
