import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { WEEK_1, kickoffOffsetMs } from "./timing";

/**
 * The happy-path baseline: an ordinary week with no pushes, ties,
 * cancellations, or postponements — the control fixture the edge-case scenarios
 * are contrasted against.
 */
export const mixedWeekScenario: SimScenarioDefinition = {
  slug: "mixed-week",
  name: "Ordinary mixed week",
  description: "A baseline week of normal finals with mixed favorites, underdogs, and upsets.",
  covers: "Happy-path scoring and standings with no edge cases",
  sport: SPORT.NFL,
  teams: SIM_LIBRARY_TEAMS,
  weeks: [WEEK_1],
  games: [
    {
      // BUF favored by 3, wins by 10: comfortable cover.
      providerGameId: "mixed-week-1",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "BUF",
      awayTeamAbbr: "MIA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 0),
      spread: -3,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 27,
      finalAwayScore: 17,
    },
    {
      // KC favored by 6, loses outright: straight-up upset.
      providerGameId: "mixed-week-2",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "KC",
      awayTeamAbbr: "DEN",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 1),
      spread: -6,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 20,
      finalAwayScore: 24,
    },
    {
      // DAL a 2-point home underdog (positive spread, PHI favored), wins outright.
      providerGameId: "mixed-week-3",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "DAL",
      awayTeamAbbr: "PHI",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 2),
      spread: 2,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 24,
      finalAwayScore: 20,
    },
    {
      // SF favored by 9, wins by 17: comfortable cover.
      providerGameId: "mixed-week-4",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "SF",
      awayTeamAbbr: "SEA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 3),
      spread: -9,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 30,
      finalAwayScore: 13,
    },
  ],
};
