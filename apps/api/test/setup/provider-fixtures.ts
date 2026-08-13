import {
  type ProviderGame,
  type ProviderTeam,
  type ProviderTeamSeasonRecord,
  type ProviderWeek,
} from "@picksleagues/core";
import { GAME_STATUS, WEEK_TYPE, type WeekType } from "@picksleagues/schemas";

/** Shared across the NFL sync + sim integration suites — a fake provider week. */
export function providerWeek(
  weekNumber: number,
  startsAt: string,
  endsAt: string,
  weekType: WeekType = WEEK_TYPE.REGULAR,
  label = `Week ${weekNumber}`,
): ProviderWeek {
  return { weekType, weekNumber, label, startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

/** Shared across the NFL sync + sim integration suites — a fake teams-listing entry. */
export function providerTeam(
  overrides: Partial<ProviderTeam> & { providerTeamId: string },
): ProviderTeam {
  return {
    abbreviation: "HOM",
    name: "Home Team",
    location: "Home",
    logoLightUrl: "https://example.com/hom-light.png",
    logoDarkUrl: "https://example.com/hom-dark.png",
    ...overrides,
  };
}

/** Shared across the NFL sync + sim integration suites — a fake provider game. */
export function providerGame(
  overrides: Partial<ProviderGame> & { providerGameId: string; weekNumber: number },
): ProviderGame {
  return {
    weekType: WEEK_TYPE.REGULAR,
    homeTeamAbbr: "HOM",
    homeTeamName: "Home Team",
    homeTeamProviderId: "hom-id",
    awayTeamAbbr: "AWY",
    awayTeamName: "Away Team",
    awayTeamProviderId: "awy-id",
    kickoffAt: new Date("2026-09-13T17:00:00.000Z"),
    status: GAME_STATUS.SCHEDULED,
    homeScore: null,
    awayScore: null,
    period: null,
    clockSeconds: null,
    spread: null,
    spreadSource: null,
    ...overrides,
  };
}

/** Shared across the stats suites — an all-zero team season record to override from. */
export function providerTeamSeasonRecord(
  providerTeamId: string,
  seasonYear: number,
  overrides?: Partial<ProviderTeamSeasonRecord>,
): ProviderTeamSeasonRecord {
  return {
    providerTeamId,
    seasonYear,
    wins: 0,
    losses: 0,
    ties: 0,
    homeWins: 0,
    homeLosses: 0,
    homeTies: 0,
    roadWins: 0,
    roadLosses: 0,
    roadTies: 0,
    streak: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    ...overrides,
  };
}
