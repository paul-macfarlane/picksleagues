import {
  getAllExternalEvents,
  getAllExternalTeams,
  upsertExternalEvent,
  upsertExternalPhase,
  upsertExternalSeason,
  upsertExternalSportsbook,
  upsertExternalTeam,
} from "@/data/external";
import { insertEvent, updateEvent, upsertOdds } from "@/data/events";
import { updatePhase, upsertPhase } from "@/data/phases";
import { upsertSeason } from "@/data/seasons";
import {
  upsertDataSource,
  upsertSportsbook,
  upsertSportsLeague,
} from "@/data/sports";
import { insertTeam, updateTeam } from "@/data/teams";
import { fetchEvents } from "@/lib/espn/nfl/events";
import { fetchOdds } from "@/lib/espn/nfl/odds";
import { fetchPhases } from "@/lib/espn/nfl/phases";
import { fetchCurrentSeason } from "@/lib/espn/nfl/seasons";
import { fetchTeams } from "@/lib/espn/nfl/teams";
import {
  calculatePhaseEndBoundary,
  calculatePhaseStartBoundary,
  calculatePickLockTime,
} from "@/lib/nfl/scheduling";

interface OddsToSync {
  eventId: string;
  oddsRef: string;
}

function log(message: string): void {
  console.log(`[nfl-setup] ${message}`);
}

export async function runInitialSetup(now?: Date): Promise<void> {
  // 1. Seed reference data
  log("Seeding reference data...");
  const [dataSource, sportsbook, sportsLeague] = await Promise.all([
    upsertDataSource({ name: "ESPN" }),
    upsertSportsbook({ name: "ESPN Bet" }),
    upsertSportsLeague({
      name: "National Football League",
      abbreviation: "NFL",
      sport: "football",
    }),
  ]);
  log("Seeded data source, sportsbook, and sports league");

  // 2. Sync current (or next upcoming) season
  log("Fetching current season from ESPN...");
  const currentSeason = await fetchCurrentSeason(now);

  const season = await upsertSeason({
    sportsLeagueId: sportsLeague.id,
    year: currentSeason.year,
    startDate: currentSeason.startDate,
    endDate: currentSeason.endDate,
  });
  await upsertExternalSeason({
    dataSourceId: dataSource.id,
    externalId: String(currentSeason.year),
    seasonId: season.id,
  });

  const currentSeasonId = season.id;
  log(`Synced season: ${currentSeason.year}`);

  // 3. Sync phases and teams in parallel (independent of each other)
  log("Fetching phases and teams from ESPN...");
  const [fetchedPhases, fetchedTeams] = await Promise.all([
    fetchPhases(currentSeason.year),
    fetchTeams(currentSeason.year),
  ]);

  // 3a. Upsert phases
  const phaseMap = new Map<
    string,
    { phaseId: string; espnTypeId: number; weekNumber: number }
  >();

  for (const fp of fetchedPhases) {
    const pickLockTime = calculatePickLockTime(fp.startDate, fp.seasonType);
    const phase = await upsertPhase({
      seasonId: currentSeasonId,
      seasonType: fp.seasonType,
      weekNumber: fp.weekNumber,
      label: fp.label,
      startDate: calculatePhaseStartBoundary(fp.startDate),
      endDate: calculatePhaseEndBoundary(fp.endDate),
      pickLockTime,
    });

    const externalId = `${currentSeason.year}-${fp.espnTypeId}-${fp.weekNumber}`;
    phaseMap.set(externalId, {
      phaseId: phase.id,
      espnTypeId: fp.espnTypeId,
      weekNumber: fp.weekNumber,
    });
    await upsertExternalPhase({
      dataSourceId: dataSource.id,
      externalId,
      phaseId: phase.id,
    });
  }
  log(`Synced ${fetchedPhases.length} phases`);

  // 3b. Upsert teams — batch lookup existing first to avoid N+1
  const existingTeams = await getAllExternalTeams(dataSource.id);
  const existingTeamMap = new Map<string, string>();
  for (const et of existingTeams) {
    existingTeamMap.set(et.externalId, et.teamId);
  }

  let teamsInserted = 0;
  let teamsUpdated = 0;

  for (const ft of fetchedTeams) {
    const existingTeamId = existingTeamMap.get(ft.espnId);
    if (existingTeamId) {
      await updateTeam(existingTeamId, {
        name: ft.name,
        location: ft.location,
        abbreviation: ft.abbreviation,
        logoUrl: ft.logoUrl ?? null,
        logoDarkUrl: ft.logoDarkUrl ?? null,
      });
      teamsUpdated++;
    } else {
      const team = await insertTeam({
        sportsLeagueId: sportsLeague.id,
        name: ft.name,
        location: ft.location,
        abbreviation: ft.abbreviation,
        logoUrl: ft.logoUrl ?? null,
        logoDarkUrl: ft.logoDarkUrl ?? null,
      });
      await upsertExternalTeam({
        dataSourceId: dataSource.id,
        externalId: ft.espnId,
        teamId: team.id,
      });
      teamsInserted++;
    }
  }
  log(
    `Synced ${fetchedTeams.length} teams (${teamsInserted} inserted, ${teamsUpdated} updated)`,
  );

  // 4. Build lookups for event sync
  const [allExternalTeams, existingExternalEvents] = await Promise.all([
    getAllExternalTeams(dataSource.id),
    getAllExternalEvents(dataSource.id),
  ]);

  const teamLookup = new Map<string, string>();
  for (const et of allExternalTeams) {
    teamLookup.set(et.externalId, et.teamId);
  }

  const existingEventMap = new Map<string, string>();
  for (const ee of existingExternalEvents) {
    existingEventMap.set(ee.externalId, ee.eventId);
  }

  // 5. Fetch events for all phases concurrently from ESPN
  log(`Fetching events for ${phaseMap.size} phases from ESPN...`);
  const phaseEntries = [...phaseMap.entries()];
  const phaseEventResults = await Promise.all(
    phaseEntries.map(async ([, info]) =>
      fetchEvents(currentSeason.year, info.espnTypeId, info.weekNumber),
    ),
  );

  // 6. Sync events and collect odds refs
  const oddsToSync: OddsToSync[] = [];
  let eventsInserted = 0;
  let eventsUpdated = 0;
  let eventsSkipped = 0;

  for (let i = 0; i < phaseEntries.length; i++) {
    const [, phaseInfo] = phaseEntries[i];
    const fetchedEvents = phaseEventResults[i];

    const eventStartTimes: Date[] = [];

    for (const fe of fetchedEvents) {
      const homeTeamId = teamLookup.get(fe.homeTeamEspnId);
      const awayTeamId = teamLookup.get(fe.awayTeamEspnId);
      if (!homeTeamId || !awayTeamId) {
        eventsSkipped++;
        continue;
      }

      const existingEventId = existingEventMap.get(fe.espnId);

      let eventId: string;
      if (existingEventId) {
        await updateEvent(existingEventId, {
          phaseId: phaseInfo.phaseId,
          homeTeamId,
          awayTeamId,
          startTime: fe.startTime,
        });
        eventId = existingEventId;
        eventsUpdated++;
      } else {
        const event = await insertEvent({
          phaseId: phaseInfo.phaseId,
          homeTeamId,
          awayTeamId,
          startTime: fe.startTime,
        });
        eventId = event.id;
        eventsInserted++;
      }

      await upsertExternalEvent({
        dataSourceId: dataSource.id,
        externalId: fe.espnId,
        eventId,
        oddsRef: fe.refs.oddsRef,
        statusRef: fe.refs.statusRef,
        homeScoreRef: fe.refs.homeScoreRef,
        awayScoreRef: fe.refs.awayScoreRef,
      });

      eventStartTimes.push(fe.startTime);

      if (fe.refs.oddsRef) {
        oddsToSync.push({ eventId, oddsRef: fe.refs.oddsRef });
      }
    }

    // Snap phase dates to Tuesday 2 AM ET boundaries around actual events
    if (eventStartTimes.length > 0) {
      const earliest = new Date(
        Math.min(...eventStartTimes.map((d) => d.getTime())),
      );
      const latest = new Date(
        Math.max(...eventStartTimes.map((d) => d.getTime())),
      );
      const startBoundary = calculatePhaseStartBoundary(earliest);
      const endBoundary = calculatePhaseEndBoundary(latest);
      await updatePhase(phaseInfo.phaseId, {
        startDate: startBoundary,
        endDate: endBoundary,
      });
    }
  }
  log(
    `Synced events: ${eventsInserted} inserted, ${eventsUpdated} updated, ${eventsSkipped} skipped`,
  );

  // 7. Sync odds — fetch concurrently from ESPN, then upsert
  log(`Fetching odds for ${oddsToSync.length} events from ESPN...`);
  const oddsResults = await Promise.all(
    oddsToSync.map(async ({ oddsRef }) => fetchOdds(oddsRef)),
  );

  let oddsSynced = 0;
  let oddsEmpty = 0;

  for (let i = 0; i < oddsToSync.length; i++) {
    const fetchedOdds = oddsResults[i];
    if (!fetchedOdds) {
      oddsEmpty++;
      continue;
    }

    const extSportsbook = await upsertExternalSportsbook({
      dataSourceId: dataSource.id,
      externalId: fetchedOdds.providerId,
      sportsbookId: sportsbook.id,
    });

    await upsertOdds({
      eventId: oddsToSync[i].eventId,
      sportsbookId: extSportsbook.sportsbookId,
      homeSpread: fetchedOdds.homeSpread,
      awaySpread: fetchedOdds.awaySpread,
      homeMoneyline: fetchedOdds.homeMoneyline,
      awayMoneyline: fetchedOdds.awayMoneyline,
      overUnder: fetchedOdds.overUnder,
    });
    oddsSynced++;
  }
  log(`Synced odds: ${oddsSynced} upserted, ${oddsEmpty} empty`);

  log("Initial setup complete");
}
