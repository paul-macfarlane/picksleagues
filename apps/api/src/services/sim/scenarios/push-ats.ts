import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { WEEK_1, kickoffOffsetMs } from "./timing";

/**
 * Exercises all three ATS outcomes in one week: an exact push (a fixed 0.5 per
 * ADR-0018), a clear cover, and a clear non-cover.
 */
export const pushAtsScenario: SimScenarioDefinition = {
  slug: "push-ats",
  name: "ATS push, cover, and non-cover",
  description: "One week with an exact ATS push alongside a clear cover and a clear non-cover.",
  covers: "ATS push/cover/non-cover outcomes and the fixed 0.5 push",
  sport: SPORT.NFL,
  teams: SIM_LIBRARY_TEAMS,
  weeks: [WEEK_1],
  games: [
    {
      // 24-21 = home by 3, spread -3 -> margin (3) equals -spread (3): exact push.
      providerGameId: "push-ats-1",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "BUF",
      awayTeamAbbr: "MIA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 0),
      spread: -3,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 24,
      finalAwayScore: 21,
    },
    {
      // 27-13 = home by 14, spread -6 -> margin (14) > -spread (6): clear cover.
      providerGameId: "push-ats-2",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "DAL",
      awayTeamAbbr: "PHI",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 1),
      spread: -6,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 27,
      finalAwayScore: 13,
    },
    {
      // 20-17 = home by 3, spread -10 -> margin (3) < -spread (10): favorite fails
      // to cover, clear non-cover for the home side.
      providerGameId: "push-ats-3",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "SF",
      awayTeamAbbr: "SEA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 2),
      spread: -10,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 20,
      finalAwayScore: 17,
    },
  ],
};
