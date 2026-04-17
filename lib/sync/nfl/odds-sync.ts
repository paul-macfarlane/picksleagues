import {
  getLockedOddsPairs,
  getOddsSyncableEvents,
  upsertOdds,
} from "@/data/events";
import { getDataSourceByName, getSportsbookByName } from "@/data/sports";
import { fetchOdds } from "@/lib/espn/nfl/odds";
import { isGameWindowActive, isNflSeasonMonth } from "@/lib/nfl/scheduling";

export interface OddsSyncResult {
  skipped: boolean;
  reason?: string;
  oddsUpdated: number;
  oddsEmpty: number;
  oddsLocked: number;
}

function log(message: string): void {
  console.log(`[nfl-odds-sync] ${message}`);
}

export async function runOddsSync(now?: Date): Promise<OddsSyncResult> {
  if (!isNflSeasonMonth(now)) {
    log("Off-season — skipping");
    return {
      skipped: true,
      reason: "off-season",
      oddsUpdated: 0,
      oddsEmpty: 0,
      oddsLocked: 0,
    };
  }

  const [dataSource, sportsbook] = await Promise.all([
    getDataSourceByName("ESPN"),
    getSportsbookByName("ESPN Bet"),
  ]);

  const syncableEvents = await getOddsSyncableEvents(dataSource.id);

  if (syncableEvents.length === 0) {
    log("No syncable events — skipping");
    return {
      skipped: true,
      reason: "no-syncable-events",
      oddsUpdated: 0,
      oddsEmpty: 0,
      oddsLocked: 0,
    };
  }

  // isGameWindowActive expects { startTime, status } — all odds-syncable events are not_started
  const eventsForWindow = syncableEvents.map((e) => ({
    startTime: e.startTime,
    status: "not_started" as const,
  }));

  if (!isGameWindowActive(eventsForWindow, now)) {
    log("No active game window — skipping");
    return {
      skipped: true,
      reason: "no-game-window",
      oddsUpdated: 0,
      oddsEmpty: 0,
      oddsLocked: 0,
    };
  }

  const lockedOddsKey = new Set<string>(
    (await getLockedOddsPairs()).map((p) => `${p.eventId}:${p.sportsbookId}`),
  );

  log(`Fetching odds for ${syncableEvents.length} events from ESPN...`);
  const fetchedOddsResults = await Promise.all(
    syncableEvents.map((e) => fetchOdds(e.oddsRef)),
  );

  let oddsUpdated = 0;
  let oddsEmpty = 0;
  let oddsLocked = 0;

  for (let i = 0; i < syncableEvents.length; i++) {
    const fetchedOdds = fetchedOddsResults[i];
    if (!fetchedOdds) {
      oddsEmpty++;
      continue;
    }

    const key = `${syncableEvents[i].eventId}:${sportsbook.id}`;
    if (lockedOddsKey.has(key)) {
      oddsLocked++;
      continue;
    }

    await upsertOdds({
      eventId: syncableEvents[i].eventId,
      sportsbookId: sportsbook.id,
      homeSpread: fetchedOdds.homeSpread,
      awaySpread: fetchedOdds.awaySpread,
      homeMoneyline: fetchedOdds.homeMoneyline,
      awayMoneyline: fetchedOdds.awayMoneyline,
      overUnder: fetchedOdds.overUnder,
    });
    oddsUpdated++;
  }

  log(
    `Sync complete: ${oddsUpdated} updated, ${oddsEmpty} empty, ${oddsLocked} locked`,
  );

  return { skipped: false, oddsUpdated, oddsEmpty, oddsLocked };
}
