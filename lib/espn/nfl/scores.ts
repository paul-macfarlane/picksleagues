import { ESPN_GAME_STATUSES, espnFetch } from "@/lib/espn/shared/client";

export type EventStatus = "not_started" | "in_progress" | "final";

export interface EspnGameStatus {
  type: {
    name: string;
    completed: boolean;
  };
  period: number;
  displayClock: string;
}

export interface EspnScore {
  value: number;
}

export interface FetchedEventScore {
  status: EventStatus;
  homeScore: number;
  awayScore: number;
  period: number | null;
  clock: string | null;
}

function mapStatus(espnStatusName: string): EventStatus {
  switch (espnStatusName) {
    case ESPN_GAME_STATUSES.IN_PROGRESS:
      return "in_progress";
    case ESPN_GAME_STATUSES.FINAL:
      return "final";
    default:
      return "not_started";
  }
}

export interface FetchEventScoreRefs {
  statusRef: string;
  homeScoreRef: string;
  awayScoreRef: string;
}

export async function fetchEventScore(
  refs: FetchEventScoreRefs,
): Promise<FetchedEventScore> {
  const [status, homeScore, awayScore] = await Promise.all([
    espnFetch<EspnGameStatus>(refs.statusRef),
    espnFetch<EspnScore>(refs.homeScoreRef),
    espnFetch<EspnScore>(refs.awayScoreRef),
  ]);

  const mapped = mapStatus(status.type.name);

  return {
    status: mapped,
    homeScore: homeScore.value,
    awayScore: awayScore.value,
    period: mapped === "in_progress" ? status.period : null,
    clock: mapped === "in_progress" ? status.displayClock : null,
  };
}
