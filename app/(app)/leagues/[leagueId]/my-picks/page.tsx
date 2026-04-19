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
import { getPicksForLeaguePhase } from "@/data/picks";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getLeagueStanding } from "@/data/standings";
import { getSession } from "@/lib/auth";
import {
  isPhaseLocked,
  isPickLocked,
  phaseLabel,
  resolvePhaseView,
  selectCurrentSeason,
} from "@/lib/nfl/leagues";
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
  const [standing, picks, oddsRows] = await Promise.all([
    getLeagueStanding(leagueId, session.user.id, currentSeason.id),
    getPicksForLeaguePhase(leagueId, session.user.id, selectedPhase.id),
    getOddsForEventsWithSportsbook(events.map((e) => e.id)),
  ]);
  const oddsByEventId = indexPrimaryOddsByEvent(oddsRows);
  const pickByEventId = new Map(picks.map((p) => [p.eventId, p]));
  const phaseLocked = isPhaseLocked(selectedPhase, now);

  return (
    <div className="flex flex-col gap-4">
      <MyPicksHeader standing={standing} memberCount={memberCount} />
      <PhaseNavigation
        basePath={`/leagues/${leagueId}/my-picks`}
        currentPhase={selectedPhase}
        prevPhase={prevPhase}
        nextPhase={nextPhase}
      />
      <PickLockBanner
        pickLockTime={selectedPhase.pickLockTime}
        isLocked={phaseLocked}
      />
      {events.length === 0 ? (
        <EmptyState
          message={`No games scheduled for ${phaseLabel(selectedPhase.seasonType, selectedPhase.weekNumber)}.`}
        />
      ) : phaseLocked ? (
        <ul className="flex flex-col gap-3">
          {events.map((event) => {
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
      ) : (
        <SubmitPicksForm
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
