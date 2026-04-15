import {
  espnFetch,
  espnFetchRef,
  nflSeasonsUrl,
} from "@/lib/espn/shared/client";
import type { EspnItemsResponse, EspnRef } from "@/lib/espn/shared/types";

export interface EspnSeason {
  year: number;
  startDate: string;
  endDate: string;
}

export interface FetchedSeason {
  year: number;
  startDate: Date;
  endDate: Date;
}

export async function fetchSeasons(): Promise<FetchedSeason[]> {
  const response = await espnFetch<EspnItemsResponse<EspnRef>>(nflSeasonsUrl());
  const seasons: FetchedSeason[] = [];
  for (const ref of response.items) {
    const season = await espnFetchRef<EspnSeason>(ref);
    seasons.push({
      year: season.year,
      startDate: new Date(season.startDate),
      endDate: new Date(season.endDate),
    });
  }
  return seasons;
}

export async function fetchCurrentSeason(
  now: Date = new Date(),
): Promise<FetchedSeason> {
  const seasons = await fetchSeasons();

  const current = seasons.find((s) => now >= s.startDate && now <= s.endDate);
  if (current) return current;

  const upcoming = seasons
    .filter((s) => s.startDate > now)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  if (upcoming[0]) return upcoming[0];

  throw new Error("No current or upcoming NFL season found");
}
