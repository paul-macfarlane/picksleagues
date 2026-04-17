import {
  getEventsBySeason,
  getLockedEventIds,
  getScorableEventsForPhase,
  updateEvent,
} from "@/data/events";
import { getPhasesBySeason } from "@/data/phases";
import { getSeasonByLeagueAndYear, removeSeason } from "@/data/seasons";
import {
  clearSimulatorState,
  getSimulatorState,
  upsertSimulatorState,
} from "@/data/simulator";
import {
  getDataSourceByName,
  getSportsLeagueByAbbreviation,
} from "@/data/sports";
import { fetchEventScore } from "@/lib/espn/nfl/scores";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { findActivePhase } from "@/lib/nfl/scheduling";
import { runInitialSetup } from "@/lib/sync/nfl/setup";

// Years before `now.getFullYear() - SIMULATOR_MAX_YEAR_OFFSET` are rejected.
// Five-year window keeps the selectable range aligned with reliable ESPN history.
export const SIMULATOR_MAX_YEAR_OFFSET = 5;

export interface SimulatorStatus {
  initialized: boolean;
  seasonYear: number | null;
  simNow: Date | null;
  currentPhase: {
    id: string;
    label: string;
    startDate: Date;
    endDate: Date;
    eventsTotal: number;
    eventsFinalized: number;
  } | null;
  totalPhases: number;
  totalEvents: number;
  finalizedEvents: number;
}

function log(message: string): void {
  console.log(`[simulator] ${message}`);
}

export async function getAppNow(): Promise<Date> {
  const state = await getSimulatorState();
  return state?.initialized ? state.simNow : new Date();
}

export function getSimulatorYearRange(now: Date = new Date()): {
  minYear: number;
  maxYear: number;
} {
  const currentYear = now.getFullYear();
  return {
    minYear: currentYear - SIMULATOR_MAX_YEAR_OFFSET,
    maxYear: currentYear,
  };
}

export function isValidSimulatorYear(
  year: number,
  now: Date = new Date(),
): boolean {
  if (!Number.isInteger(year)) return false;
  const { minYear, maxYear } = getSimulatorYearRange(now);
  return year >= minYear && year <= maxYear;
}

export async function initializeSeason(
  year: number,
  now: Date = new Date(),
): Promise<SimulatorStatus> {
  if (!isValidSimulatorYear(year, now)) {
    throw new BadRequestError(
      `Year must be within the last ${SIMULATOR_MAX_YEAR_OFFSET + 1} years`,
    );
  }

  await resetSeason();

  // Sept 15 of the target year steers fetchCurrentSeason() to that year.
  const setupNow = new Date(Date.UTC(year, 8, 15));
  log(`Initializing season ${year}...`);
  await runInitialSetup(setupNow);

  const sportsLeague = await getSportsLeagueByAbbreviation("NFL");
  const season = await getSeasonByLeagueAndYear(sportsLeague.id, year);
  if (!season) {
    throw new NotFoundError(`Season ${year} not found after setup`);
  }
  const phases = await getPhasesBySeason(season.id);
  if (phases.length === 0) {
    throw new NotFoundError(`No phases synced for season ${year}`);
  }

  const firstPhase = phases[0];
  const simNow = new Date(firstPhase.startDate.getTime() + 1);
  await upsertSimulatorState({ seasonYear: year, simNow, initialized: true });

  log(`Initialized season ${year} — simNow ${simNow.toISOString()}`);
  return getStatus();
}

export async function advancePhase(): Promise<SimulatorStatus> {
  const state = await getSimulatorState();
  if (!state?.initialized) {
    throw new BadRequestError("Simulator not initialized");
  }

  const [dataSource, sportsLeague] = await Promise.all([
    getDataSourceByName("ESPN"),
    getSportsLeagueByAbbreviation("NFL"),
  ]);
  const season = await getSeasonByLeagueAndYear(
    sportsLeague.id,
    state.seasonYear,
  );
  if (!season) {
    throw new NotFoundError(`Season ${state.seasonYear} not found`);
  }
  const phases = await getPhasesBySeason(season.id);
  const currentPhase = findActivePhase(phases, state.simNow);
  if (!currentPhase) {
    throw new BadRequestError("No active phase to advance");
  }

  const [allScorableEvents, lockedEventIds] = await Promise.all([
    getScorableEventsForPhase(currentPhase.id, dataSource.id),
    getLockedEventIds(),
  ]);
  const scorableEvents = allScorableEvents.filter(
    (e) => !lockedEventIds.has(e.eventId),
  );
  const lockedCount = allScorableEvents.length - scorableEvents.length;

  log(
    `Advancing "${currentPhase.label}" — finalizing ${scorableEvents.length} event(s)` +
      (lockedCount > 0 ? ` (${lockedCount} locked, skipped)` : ""),
  );

  const fetchedScores = await Promise.all(
    scorableEvents.map((e) =>
      fetchEventScore({
        statusRef: e.statusRef,
        homeScoreRef: e.homeScoreRef,
        awayScoreRef: e.awayScoreRef,
      }),
    ),
  );

  await Promise.all(
    scorableEvents.map((e, i) =>
      updateEvent(e.eventId, {
        status: fetchedScores[i].status,
        homeScore: fetchedScores[i].homeScore,
        awayScore: fetchedScores[i].awayScore,
      }),
    ),
  );

  // Jump to the next phase's start. Phases come back ordered by startDate,
  // so a simple index+1 lookup skips any between-phase gap without risking
  // a strict-greater comparison dropping a contiguous neighbor.
  const currentIndex = phases.findIndex((p) => p.id === currentPhase.id);
  const nextPhase = currentIndex >= 0 ? phases[currentIndex + 1] : undefined;
  const newSimNow = nextPhase
    ? new Date(nextPhase.startDate.getTime() + 1)
    : new Date(currentPhase.endDate.getTime() + 1);

  await upsertSimulatorState({
    seasonYear: state.seasonYear,
    simNow: newSimNow,
    initialized: true,
  });

  log(`Advanced simNow to ${newSimNow.toISOString()}`);
  return getStatus();
}

export async function getStatus(): Promise<SimulatorStatus> {
  const state = await getSimulatorState();
  if (!state?.initialized) {
    return {
      initialized: false,
      seasonYear: null,
      simNow: null,
      currentPhase: null,
      totalPhases: 0,
      totalEvents: 0,
      finalizedEvents: 0,
    };
  }

  let sportsLeague;
  try {
    sportsLeague = await getSportsLeagueByAbbreviation("NFL");
  } catch (err) {
    if (err instanceof NotFoundError) {
      return emptyStatusWithState(state.seasonYear, state.simNow);
    }
    throw err;
  }

  const season = await getSeasonByLeagueAndYear(
    sportsLeague.id,
    state.seasonYear,
  );
  if (!season) {
    return emptyStatusWithState(state.seasonYear, state.simNow);
  }

  const [phases, seasonEvents] = await Promise.all([
    getPhasesBySeason(season.id),
    getEventsBySeason(season.id),
  ]);
  const currentPhase = findActivePhase(phases, state.simNow);
  const finalizedEvents = seasonEvents.filter(
    (e) => e.status === "final",
  ).length;

  const currentPhaseInfo = currentPhase
    ? {
        id: currentPhase.id,
        label: currentPhase.label,
        startDate: currentPhase.startDate,
        endDate: currentPhase.endDate,
        eventsTotal: seasonEvents.filter((e) => e.phaseId === currentPhase.id)
          .length,
        eventsFinalized: seasonEvents.filter(
          (e) => e.phaseId === currentPhase.id && e.status === "final",
        ).length,
      }
    : null;

  return {
    initialized: true,
    seasonYear: state.seasonYear,
    simNow: state.simNow,
    currentPhase: currentPhaseInfo,
    totalPhases: phases.length,
    totalEvents: seasonEvents.length,
    finalizedEvents,
  };
}

export async function resetSeason(): Promise<SimulatorStatus> {
  const state = await getSimulatorState();
  if (!state) {
    return getStatus();
  }

  try {
    const sportsLeague = await getSportsLeagueByAbbreviation("NFL");
    const season = await getSeasonByLeagueAndYear(
      sportsLeague.id,
      state.seasonYear,
    );
    if (season) {
      // Cascades phases → events → odds and all external_* bridge rows.
      await removeSeason(season.id);
      log(`Deleted season ${state.seasonYear}`);
    }
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }

  await clearSimulatorState();
  log("Simulator state cleared");
  return getStatus();
}

function emptyStatusWithState(
  seasonYear: number,
  simNow: Date,
): SimulatorStatus {
  return {
    initialized: true,
    seasonYear,
    simNow,
    currentPhase: null,
    totalPhases: 0,
    totalEvents: 0,
    finalizedEvents: 0,
  };
}
