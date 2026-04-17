import type { Metadata } from "next";

import type { OverridesTabValue } from "@/components/admin/overrides/overrides-tabs";
import { OverridesTabs } from "@/components/admin/overrides/overrides-tabs";
import { EventsTable } from "@/components/admin/overrides/events-table";
import { OddsTable } from "@/components/admin/overrides/odds-table";
import { PhaseFilter } from "@/components/admin/overrides/phase-filter";
import { PhasesTable } from "@/components/admin/overrides/phases-table";
import { SeasonFilter } from "@/components/admin/overrides/season-filter";
import { TeamsTable } from "@/components/admin/overrides/teams-table";
import {
  getEventsByPhaseWithTeams,
  getOddsByPhaseWithContext,
} from "@/data/events";
import { getExternalEventsByEventIds } from "@/data/external";
import { getPhasesBySeason } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSportsLeagueByAbbreviation } from "@/data/sports";
import { getTeamsBySportsLeague } from "@/data/teams";
import type { ExternalEvent } from "@/lib/db/schema/external";
import { OVERRIDE_ENTITIES } from "@/lib/validators/admin-overrides";

export const metadata: Metadata = {
  title: "Overrides",
};

function parseTab(raw: string | string[] | undefined): OverridesTabValue {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return OVERRIDE_ENTITIES.includes(value as OverridesTabValue)
    ? (value as OverridesTabValue)
    : "team";
}

function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function resolveActiveId<T extends { id: string }>(
  items: T[],
  candidate: string | undefined,
): string {
  return candidate && items.some((item) => item.id === candidate)
    ? candidate
    : items[0].id;
}

export default async function AdminOverridesPage(
  props: PageProps<"/admin/overrides">,
) {
  const searchParams = await props.searchParams;
  const tab = parseTab(searchParams.tab);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Overrides</h1>
        <p className="text-sm text-muted-foreground">
          Manually correct teams, phases, events, and odds when ESPN data is
          wrong. Locked rows are skipped by every sync until you unlock them.
        </p>
      </header>

      <OverridesTabs active={tab} />

      {tab === "team" ? (
        <TeamsTabContent />
      ) : tab === "phase" ? (
        <PhasesTabContent season={firstParam(searchParams.season)} />
      ) : tab === "event" ? (
        <EventsTabContent
          season={firstParam(searchParams.season)}
          phase={firstParam(searchParams.phase)}
        />
      ) : (
        <OddsTabContent
          season={firstParam(searchParams.season)}
          phase={firstParam(searchParams.phase)}
        />
      )}
    </div>
  );
}

async function TeamsTabContent() {
  const nfl = await getSportsLeagueByAbbreviation("NFL");
  const teams = await getTeamsBySportsLeague(nfl.id);
  return <TeamsTable teams={teams} />;
}

async function PhasesTabContent({ season }: { season: string | undefined }) {
  const nfl = await getSportsLeagueByAbbreviation("NFL");
  const seasons = await getSeasonsBySportsLeague(nfl.id);

  if (seasons.length === 0) {
    return <EmptySeasonsMessage />;
  }

  const activeSeasonId = resolveActiveId(seasons, season);
  const phases = await getPhasesBySeason(activeSeasonId);

  return (
    <div className="flex flex-col gap-3">
      <SeasonFilter seasons={seasons} current={activeSeasonId} />
      <PhasesTable phases={phases} />
    </div>
  );
}

async function EventsTabContent({
  season,
  phase,
}: {
  season: string | undefined;
  phase: string | undefined;
}) {
  const nfl = await getSportsLeagueByAbbreviation("NFL");
  const seasons = await getSeasonsBySportsLeague(nfl.id);

  if (seasons.length === 0) {
    return <EmptySeasonsMessage />;
  }

  const activeSeasonId = resolveActiveId(seasons, season);
  const phases = await getPhasesBySeason(activeSeasonId);

  if (phases.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <SeasonFilter seasons={seasons} current={activeSeasonId} />
        <EmptyPhasesMessage />
      </div>
    );
  }

  const activePhaseId = resolveActiveId(phases, phase);
  const events = await getEventsByPhaseWithTeams(activePhaseId);
  const externalEvents = await getExternalEventsByEventIds(
    events.map((e) => e.id),
  );
  const externalEventMap = new Map<string, ExternalEvent>();
  for (const row of externalEvents) {
    externalEventMap.set(row.eventId, row);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <SeasonFilter seasons={seasons} current={activeSeasonId} />
        <PhaseFilter phases={phases} current={activePhaseId} />
      </div>
      <EventsTable events={events} externalEventMap={externalEventMap} />
    </div>
  );
}

async function OddsTabContent({
  season,
  phase,
}: {
  season: string | undefined;
  phase: string | undefined;
}) {
  const nfl = await getSportsLeagueByAbbreviation("NFL");
  const seasons = await getSeasonsBySportsLeague(nfl.id);

  if (seasons.length === 0) {
    return <EmptySeasonsMessage />;
  }

  const activeSeasonId = resolveActiveId(seasons, season);
  const phases = await getPhasesBySeason(activeSeasonId);

  if (phases.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <SeasonFilter seasons={seasons} current={activeSeasonId} />
        <EmptyPhasesMessage />
      </div>
    );
  }

  const activePhaseId = resolveActiveId(phases, phase);
  const odds = await getOddsByPhaseWithContext(activePhaseId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <SeasonFilter seasons={seasons} current={activeSeasonId} />
        <PhaseFilter phases={phases} current={activePhaseId} />
      </div>
      <OddsTable odds={odds} />
    </div>
  );
}

function EmptySeasonsMessage() {
  return (
    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      No seasons synced yet. Run the NFL setup cron or the simulator first.
    </p>
  );
}

function EmptyPhasesMessage() {
  return (
    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      This season has no phases synced.
    </p>
  );
}
