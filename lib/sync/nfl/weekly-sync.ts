import {
  getDataSourceByName,
  getSportsLeagueByAbbreviation,
} from "@/data/sports";
import { isNflSeasonMonth } from "@/lib/nfl/scheduling";

import { runStructuralSync } from "./structural";

export interface WeeklySyncResult {
  skipped: boolean;
  reason?: string;
  seasonYear?: number;
  phasesUpserted: number;
  teamsInserted: number;
  teamsUpdated: number;
  eventsInserted: number;
  eventsUpdated: number;
  eventsSkipped: number;
}

function log(message: string): void {
  console.log(`[nfl-weekly-sync] ${message}`);
}

const EMPTY_COUNTS = {
  phasesUpserted: 0,
  teamsInserted: 0,
  teamsUpdated: 0,
  eventsInserted: 0,
  eventsUpdated: 0,
  eventsSkipped: 0,
};

export async function runWeeklySync(now?: Date): Promise<WeeklySyncResult> {
  if (!isNflSeasonMonth(now)) {
    log("Off-season — skipping");
    return { skipped: true, reason: "off-season", ...EMPTY_COUNTS };
  }

  const [dataSource, sportsLeague] = await Promise.all([
    getDataSourceByName("ESPN"),
    getSportsLeagueByAbbreviation("NFL"),
  ]);

  const structural = await runStructuralSync({ dataSource, sportsLeague, now });

  log(
    `Sync complete: ${structural.phasesUpserted} phases, ` +
      `${structural.teamsInserted} teams inserted / ${structural.teamsUpdated} updated, ` +
      `${structural.eventsInserted} events inserted / ${structural.eventsUpdated} updated / ${structural.eventsSkipped} skipped`,
  );

  return {
    skipped: false,
    seasonYear: structural.seasonYear,
    phasesUpserted: structural.phasesUpserted,
    teamsInserted: structural.teamsInserted,
    teamsUpdated: structural.teamsUpdated,
    eventsInserted: structural.eventsInserted,
    eventsUpdated: structural.eventsUpdated,
    eventsSkipped: structural.eventsSkipped,
  };
}
