import { notFound } from "next/navigation";

import { MemberPicksCard } from "@/components/picks/member-picks-card";
import { PhaseNavigation } from "@/components/picks/phase-navigation";
import { PickLockBanner } from "@/components/picks/pick-lock-banner";
import {
  getEventsByPhaseWithTeams,
  getOddsForEventsWithSportsbook,
  type OddsWithSportsbookName,
} from "@/data/events";
import { getLeagueById } from "@/data/leagues";
import { getPhasesBySeason } from "@/data/phases";
import { getPicksForLeaguePhaseAllMembers } from "@/data/picks";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getStandingsForLeagueSeasonWithProfiles } from "@/data/standings";
import { getSession } from "@/lib/auth";
import type { League } from "@/lib/db/schema/leagues";
import {
  comparePhasesByOrdinal,
  isPhaseInLeagueRange,
  isPhaseLocked,
  phaseLabel,
  selectCurrentSeason,
  selectLeagueCurrentPhase,
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
  const phasesInRange = allPhases
    .filter((p) => isPhaseInLeagueRange(p, league))
    .sort(comparePhasesByOrdinal);

  const requestedPhase = requestedPhaseId
    ? (phasesInRange.find((p) => p.id === requestedPhaseId) ?? null)
    : null;
  const selectedPhase =
    requestedPhase ?? selectLeagueCurrentPhase(allPhases, league, now);

  if (!selectedPhase) {
    return (
      <EmptyState message="This league's schedule range has no synced phases yet." />
    );
  }

  const currentIndex = phasesInRange.findIndex(
    (p) => p.id === selectedPhase.id,
  );
  const prevPhase = currentIndex > 0 ? phasesInRange[currentIndex - 1] : null;
  const nextPhase =
    currentIndex >= 0 && currentIndex < phasesInRange.length - 1
      ? phasesInRange[currentIndex + 1]
      : null;

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

  const oddsByEventId = new Map<string, OddsWithSportsbookName>();
  for (const row of oddsRows) {
    if (!oddsByEventId.has(row.eventId)) {
      oddsByEventId.set(row.eventId, row);
    }
  }

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
