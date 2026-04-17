import { getLockedOddsPairs, upsertOdds } from "@/data/events";
import { upsertExternalSportsbook } from "@/data/external";
import {
  upsertDataSource,
  upsertSportsbook,
  upsertSportsLeague,
} from "@/data/sports";
import { fetchOdds } from "@/lib/espn/nfl/odds";
import {
  ESPN_FETCH_CONCURRENCY,
  mapWithConcurrency,
} from "@/lib/espn/shared/client";

import { runStructuralSync } from "./structural";

export interface InitialSetupResult {
  seasonYear: number;
  phasesUpserted: number;
  phasesLocked: number;
  teamsInserted: number;
  teamsUpdated: number;
  teamsLocked: number;
  eventsInserted: number;
  eventsUpdated: number;
  eventsSkipped: number;
  eventsLocked: number;
  oddsUpserted: number;
  oddsEmpty: number;
  oddsLocked: number;
}

function log(message: string): void {
  console.log(`[nfl-setup] ${message}`);
}

export async function runInitialSetup(now?: Date): Promise<InitialSetupResult> {
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

  // 2. Structural sync: season + phases + teams + events
  const structural = await runStructuralSync({ dataSource, sportsLeague, now });

  // 3. Sync odds for every event with an oddsRef — skip locked pairs
  log(`Fetching odds for ${structural.oddsToSync.length} events from ESPN...`);
  const [oddsResults, lockedOddsPairs] = await Promise.all([
    mapWithConcurrency(
      structural.oddsToSync,
      ESPN_FETCH_CONCURRENCY,
      ({ oddsRef }) => fetchOdds(oddsRef),
    ),
    getLockedOddsPairs(),
  ]);
  const lockedOddsKey = new Set<string>(
    lockedOddsPairs.map((p) => `${p.eventId}:${p.sportsbookId}`),
  );

  let oddsUpserted = 0;
  let oddsEmpty = 0;
  let oddsLocked = 0;

  for (let i = 0; i < structural.oddsToSync.length; i++) {
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

    const key = `${structural.oddsToSync[i].eventId}:${extSportsbook.sportsbookId}`;
    if (lockedOddsKey.has(key)) {
      oddsLocked++;
      continue;
    }

    await upsertOdds({
      eventId: structural.oddsToSync[i].eventId,
      sportsbookId: extSportsbook.sportsbookId,
      homeSpread: fetchedOdds.homeSpread,
      awaySpread: fetchedOdds.awaySpread,
      homeMoneyline: fetchedOdds.homeMoneyline,
      awayMoneyline: fetchedOdds.awayMoneyline,
      overUnder: fetchedOdds.overUnder,
    });
    oddsUpserted++;
  }
  log(
    `Synced odds: ${oddsUpserted} upserted, ${oddsEmpty} empty, ${oddsLocked} locked`,
  );

  log("Initial setup complete");

  return {
    seasonYear: structural.seasonYear,
    phasesUpserted: structural.phasesUpserted,
    phasesLocked: structural.phasesLocked,
    teamsInserted: structural.teamsInserted,
    teamsUpdated: structural.teamsUpdated,
    teamsLocked: structural.teamsLocked,
    eventsInserted: structural.eventsInserted,
    eventsUpdated: structural.eventsUpdated,
    eventsSkipped: structural.eventsSkipped,
    eventsLocked: structural.eventsLocked,
    oddsUpserted,
    oddsEmpty,
    oddsLocked,
  };
}
