import { type ProviderGame, type ProviderWeek } from "@picksleagues/core";
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
    ...overrides,
  };
}
