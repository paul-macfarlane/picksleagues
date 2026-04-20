import { notFound } from "next/navigation";

import { EventPickCard } from "@/components/picks/event-pick-card";
import { MyPicksHeader } from "@/components/picks/my-picks-header";
import { PhaseNavigation } from "@/components/picks/phase-navigation";
import { PickLockBanner } from "@/components/picks/pick-lock-banner";
import { SubmitPicksForm } from "@/components/picks/submit-picks-form";
import {
  getEventsByPhaseWithTeams,
  getOddsForEventsWithSportsbook,
  indexPrimaryOddsByEvent,
} from "@/data/events";
import { getLeagueById, getLeagueMemberCount } from "@/data/leagues";
import { getPhasesBySeason } from "@/data/phases";
import {
  getPicksForLeaguePhase,
  getPicksForLeaguePhaseAllMembers,
} from "@/data/picks";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import {
  getLeagueStanding,
  getStandingsForLeagueSeasonWithProfiles,
} from "@/data/standings";
import { getSession } from "@/lib/auth";
import {
  isPhaseLocked,
  isPickLocked,
  phaseLabel,
  resolvePhaseView,
  selectCurrentSeason,
  selectLeagueCurrentPhase,
} from "@/lib/nfl/leagues";
import { calculateWeeklyStandings } from "@/lib/nfl/scoring";
import { getAppNow } from "@/lib/simulator";

export default async function MyPicksPage(
  props: PageProps<"/leagues/[leagueId]/my-picks">,
) {
  const { leagueId } = await props.params;
  const searchParams = await props.searchParams;
  const phaseIdParam = searchParams.phase;
  const requestedPhaseId =
    typeof phaseIdParam === "string" ? phaseIdParam : null;

  const session = await getSession();
  const league = await getLeagueById(leagueId);
  if (!league) notFound();

  const now = await getAppNow();
  const [memberCount, seasons] = await Promise.all([
    getLeagueMemberCount(leagueId),
    getSeasonsBySportsLeague(league.sportsLeagueId),
  ]);
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

  const events = await getEventsByPhaseWithTeams(selectedPhase.id);
  const [standing, picks, oddsRows, memberStandings, allPhasePicks] =
    await Promise.all([
      getLeagueStanding(leagueId, session.user.id, currentSeason.id),
      getPicksForLeaguePhase(leagueId, session.user.id, selectedPhase.id),
      getOddsForEventsWithSportsbook(events.map((e) => e.id)),
      getStandingsForLeagueSeasonWithProfiles(leagueId, currentSeason.id),
      getPicksForLeaguePhaseAllMembers(leagueId, selectedPhase.id),
    ]);
  const oddsByEventId = indexPrimaryOddsByEvent(oddsRows);
  const pickByEventId = new Map(picks.map((p) => [p.eventId, p]));
  const phaseLocked = isPhaseLocked(selectedPhase, now);
  const currentPhase = selectLeagueCurrentPhase(allPhases, league, now);
  const isCurrentPhase = currentPhase?.id === selectedPhase.id;
  const canSubmitPicks = !phaseLocked && isCurrentPhase;

  // Weekly row is only meaningful once at least one pick this phase is
  // scored. Before that everyone is 0-0-0 and the row is visual noise.
  const hasAnyScoredThisPhase = allPhasePicks.some((p) => p.pickResult != null);
  const viewerWeekly = hasAnyScoredThisPhase
    ? (calculateWeeklyStandings(
        allPhasePicks,
        memberStandings.map((s) => s.userId),
      ).find((w) => w.userId === session.user.id) ?? null)
    : null;

  // After lock, drop games the viewer didn't pick — they're noise on the
  // "My Picks" surface. Future phases (pre-lock, not current) still show
  // the full schedule so the user can preview upcoming games.
  const eventsToShow = phaseLocked
    ? events.filter((e) => pickByEventId.has(e.id))
    : events;

  return (
    <div className="flex flex-col gap-4">
      <MyPicksHeader
        standing={standing}
        weekly={viewerWeekly}
        memberCount={memberCount}
      />
      <PhaseNavigation
        basePath={`/leagues/${leagueId}/my-picks`}
        currentPhase={selectedPhase}
        prevPhase={prevPhase}
        nextPhase={nextPhase}
      />
      <PickLockBanner
        pickLockTime={selectedPhase.pickLockTime}
        phaseStartDate={selectedPhase.startDate}
        isLocked={phaseLocked}
        isFuture={!phaseLocked && !isCurrentPhase}
      />
      {events.length === 0 ? (
        <EmptyState
          message={`No games scheduled for ${phaseLabel(selectedPhase.seasonType, selectedPhase.weekNumber)}.`}
        />
      ) : !canSubmitPicks ? (
        eventsToShow.length === 0 ? (
          <EmptyState message="You didn't submit picks for this week." />
        ) : (
          <ul className="flex flex-col gap-3">
            {eventsToShow.map((event) => {
              const pick = pickByEventId.get(event.id) ?? null;
              const locked = isPickLocked(selectedPhase, event, now);
              return (
                <li key={event.id}>
                  <EventPickCard
                    event={event}
                    homeTeam={event.homeTeam}
                    awayTeam={event.awayTeam}
                    odds={oddsByEventId.get(event.id) ?? null}
                    pickType={league.pickType}
                    selectedTeamId={pick?.teamId ?? null}
                    frozenSpread={pick?.spreadAtLock ?? null}
                    pickResult={pick?.pickResult ?? null}
                    isLocked={locked}
                  />
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <SubmitPicksForm
          key={selectedPhase.id}
          leagueId={leagueId}
          phaseId={selectedPhase.id}
          events={events}
          oddsByEventId={Object.fromEntries(oddsByEventId)}
          pickType={league.pickType}
          existingPicks={picks}
          picksPerPhase={league.picksPerPhase}
          nowMs={now.getTime()}
        />
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </section>
  );
}
