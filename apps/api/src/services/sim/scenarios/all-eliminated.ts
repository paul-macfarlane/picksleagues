import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { WEEK_1, kickoffOffsetMs } from "./timing";

/**
 * Every favorite loses outright, so a member picking straight-up favorites
 * every week busts in the same week (spec §Survivor: "Incorrect or no
 * pick -> eliminated"; "If multiple members are still alive, they are
 * co-winners" only applies when *someone* survives — this fixture is the
 * case where nobody plausibly does).
 */
export const allEliminatedScenario: SimScenarioDefinition = {
  slug: "all-eliminated",
  name: "All favorites lose",
  description: "Every favorite loses its game outright, so any favorite-only pick set busts.",
  covers: "Survivor week where every plausible pick is wrong",
  sport: SPORT.NFL,
  teams: SIM_LIBRARY_TEAMS,
  weeks: [WEEK_1],
  games: [
    {
      // BUF favored by 3, loses outright to MIA.
      providerGameId: "all-eliminated-1",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "BUF",
      awayTeamAbbr: "MIA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 0),
      spread: -3,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 17,
      finalAwayScore: 24,
    },
    {
      // KC favored by 6, loses outright to DEN.
      providerGameId: "all-eliminated-2",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "KC",
      awayTeamAbbr: "DEN",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 1),
      spread: -6,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 14,
      finalAwayScore: 20,
    },
    {
      // DAL favored by 4, loses outright to PHI.
      providerGameId: "all-eliminated-3",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "DAL",
      awayTeamAbbr: "PHI",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 2),
      spread: -4,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 13,
      finalAwayScore: 21,
    },
    {
      // SF favored by 7, loses outright to SEA.
      providerGameId: "all-eliminated-4",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "SF",
      awayTeamAbbr: "SEA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 3),
      spread: -7,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 16,
      finalAwayScore: 23,
    },
  ],
};
