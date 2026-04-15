import {
  ESPN_SEASON_TYPES,
  espnFetch,
  espnFetchRef,
  nflWeeksUrl,
} from "@/lib/espn/shared/client";
import type { EspnItemsResponse, EspnRef } from "@/lib/espn/shared/types";

export type EspnSeasonType = "regular" | "postseason";

export interface EspnWeek {
  number: number;
  text: string;
  startDate: string;
  endDate: string;
  events?: EspnRef;
}

export interface FetchedPhase {
  weekNumber: number;
  label: string;
  startDate: Date;
  endDate: Date;
  seasonType: EspnSeasonType;
  espnTypeId: number;
}

function isProBowlLabel(label: string): boolean {
  return label.startsWith("Pro Bowl");
}

function mapSeasonType(espnTypeId: number): EspnSeasonType {
  return espnTypeId === ESPN_SEASON_TYPES.REGULAR ? "regular" : "postseason";
}

export async function fetchPhases(seasonYear: number): Promise<FetchedPhase[]> {
  const typeIds = [ESPN_SEASON_TYPES.REGULAR, ESPN_SEASON_TYPES.POSTSEASON];
  const phases: FetchedPhase[] = [];

  for (const typeId of typeIds) {
    const response = await espnFetch<EspnItemsResponse<EspnRef>>(
      nflWeeksUrl(seasonYear, typeId),
    );

    for (const ref of response.items) {
      const week = await espnFetchRef<EspnWeek>(ref);

      if (isProBowlLabel(week.text)) continue;

      phases.push({
        weekNumber: week.number,
        label: week.text,
        startDate: new Date(week.startDate),
        endDate: new Date(week.endDate),
        seasonType: mapSeasonType(typeId),
        espnTypeId: typeId,
      });
    }
  }

  return phases.sort(
    (a, b) => a.espnTypeId - b.espnTypeId || a.weekNumber - b.weekNumber,
  );
}
