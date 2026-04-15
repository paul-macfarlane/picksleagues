import type { EspnRef } from "./types";

const ESPN_BASE_URL = "https://sports.core.api.espn.com/v2";
const NFL_PATH = "/sports/football/leagues/nfl";

// ESPN paginates at 10 items by default; bump to 100 so one request usually returns all items.
const LIMIT_QS = "?limit=100";

export const ESPN_SEASON_TYPES = {
  PRESEASON: 1,
  REGULAR: 2,
  POSTSEASON: 3,
  OFFSEASON: 4,
} as const;

export const ESPN_GAME_STATUSES = {
  SCHEDULED: "STATUS_SCHEDULED",
  IN_PROGRESS: "STATUS_IN_PROGRESS",
  FINAL: "STATUS_FINAL",
  POSTPONED: "STATUS_POSTPONED",
} as const;

export class EspnApiError extends Error {
  constructor(
    public url: string,
    public status: number,
    message: string,
  ) {
    super(`ESPN API error (${status}) for ${url}: ${message}`);
    this.name = "EspnApiError";
  }
}

export async function espnFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new EspnApiError(url, response.status, response.statusText);
  }
  return response.json() as Promise<T>;
}

export async function espnFetchRef<T>(ref: EspnRef): Promise<T> {
  return espnFetch<T>(ref.$ref);
}

export function nflSeasonsUrl(): string {
  return `${ESPN_BASE_URL}${NFL_PATH}/seasons${LIMIT_QS}`;
}

export function nflWeeksUrl(year: number, typeId: number): string {
  return `${ESPN_BASE_URL}${NFL_PATH}/seasons/${year}/types/${typeId}/weeks${LIMIT_QS}`;
}

export function nflTeamsUrl(year: number): string {
  return `${ESPN_BASE_URL}${NFL_PATH}/seasons/${year}/teams${LIMIT_QS}`;
}

export function nflEventsUrl(
  year: number,
  typeId: number,
  weekNumber: number,
): string {
  return `${ESPN_BASE_URL}${NFL_PATH}/seasons/${year}/types/${typeId}/weeks/${weekNumber}/events${LIMIT_QS}`;
}
