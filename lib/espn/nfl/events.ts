import {
  espnFetch,
  espnFetchRef,
  nflEventsUrl,
} from "@/lib/espn/shared/client";
import type { EspnItemsResponse, EspnRef } from "@/lib/espn/shared/types";

export interface EspnCompetitor {
  id: string;
  homeAway: "home" | "away";
  team: EspnRef;
  score?: EspnRef;
}

export interface EspnCompetition {
  competitors: EspnCompetitor[];
  odds?: EspnRef;
  status?: EspnRef;
}

export interface EspnEvent {
  id: string;
  date: string;
  competitions: EspnCompetition[];
}

export interface FetchedEvent {
  espnId: string;
  startTime: Date;
  homeTeamEspnId: string;
  awayTeamEspnId: string;
  refs: {
    oddsRef: string | null;
    statusRef: string | null;
    homeScoreRef: string | null;
    awayScoreRef: string | null;
  };
}

export async function fetchEvents(
  seasonYear: number,
  typeId: number,
  weekNumber: number,
): Promise<FetchedEvent[]> {
  const response = await espnFetch<EspnItemsResponse<EspnRef>>(
    nflEventsUrl(seasonYear, typeId, weekNumber),
  );

  const events: FetchedEvent[] = [];
  for (const ref of response.items) {
    const event = await espnFetchRef<EspnEvent>(ref);

    const competition = event.competitions[0];
    if (!competition) continue;

    const home = competition.competitors.find((c) => c.homeAway === "home");
    const away = competition.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    events.push({
      espnId: event.id,
      startTime: new Date(event.date),
      homeTeamEspnId: home.id,
      awayTeamEspnId: away.id,
      refs: {
        oddsRef: competition.odds?.$ref ?? null,
        statusRef: competition.status?.$ref ?? null,
        homeScoreRef: home.score?.$ref ?? null,
        awayScoreRef: away.score?.$ref ?? null,
      },
    });
  }
  return events;
}
