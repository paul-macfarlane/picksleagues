import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { WEEK_1, kickoffOffsetMs } from "./timing";

/**
 * A postponed game alongside normal ones (spec §Testing & Internal Tooling:
 * fixture library must reproduce postponements distinctly from cancellations).
 */
export const postponedGameScenario: SimScenarioDefinition = {
  slug: "postponed-game",
  name: "Postponed game",
  description: "One postponed game with null scores in a week of otherwise normal games.",
  covers: "Postponement handling, kept distinct from cancellation",
  sport: SPORT.NFL,
  teams: SIM_LIBRARY_TEAMS,
  weeks: [WEEK_1],
  games: [
    {
      providerGameId: "postponed-game-1",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "SF",
      awayTeamAbbr: "SEA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 0),
      spread: -7,
      finalStatus: SIM_FINAL_STATUS.POSTPONED,
      finalHomeScore: null,
      finalAwayScore: null,
    },
    {
      // 24-17 = home by 7, spread -3: an ordinary cover.
      providerGameId: "postponed-game-2",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "BUF",
      awayTeamAbbr: "MIA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 1),
      spread: -3,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 24,
      finalAwayScore: 17,
    },
    {
      // 27-13 = home by 14, spread -6: an ordinary cover.
      providerGameId: "postponed-game-3",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "KC",
      awayTeamAbbr: "DEN",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 2),
      spread: -6,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 27,
      finalAwayScore: 13,
    },
  ],
};
