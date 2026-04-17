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

// Upper bound on concurrent ESPN requests in a batch. Keeps DNS lookups and
// connection pools from being saturated when a single run fans out hundreds
// of fetches (e.g., odds for ~285 events during initial setup).
export const ESPN_FETCH_CONCURRENCY = 8;

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 200;
const RETRIABLE_NETWORK_CODES = new Set([
  "ENOTFOUND",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

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

function isRetriableError(err: unknown): boolean {
  if (err instanceof EspnApiError) {
    return err.status === 429 || err.status >= 500;
  }
  if (err instanceof TypeError && err.message === "fetch failed") {
    const cause = (err as { cause?: { code?: string } }).cause;
    return !!cause?.code && RETRIABLE_NETWORK_CODES.has(cause.code);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function espnFetch<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new EspnApiError(url, response.status, response.statusText);
      }
      return (await response.json()) as T;
    } catch (err) {
      const isLast = attempt === MAX_RETRIES - 1;
      if (isLast || !isRetriableError(err)) throw err;
      // Exponential backoff with jitter to stagger concurrent retries.
      const delay = RETRY_BASE_MS * 2 ** attempt + Math.random() * 100;
      await sleep(delay);
    }
  }
  // Unreachable: the loop either returns or throws on the final attempt.
  throw new Error("espnFetch exhausted retries");
}

export async function espnFetchRef<T>(ref: EspnRef): Promise<T> {
  return espnFetch<T>(ref.$ref);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
