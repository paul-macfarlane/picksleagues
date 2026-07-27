import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { WEEK_1, kickoffOffsetMs } from "./timing";

/**
 * A cancelled game alongside normal ones (spec §Pick'em Modes: "Cancelled
 * game: the pick resolves as a push. The member may re-pick by substituting
 * any unstarted game from the same week").
 */
export const cancelledGameScenario: SimScenarioDefinition = {
  slug: "cancelled-game",
  name: "Cancelled game",
  description: "One cancelled game with null scores in a week of otherwise normal games.",
  covers: "Cancellation-as-push and same-week re-pick eligibility",
  sport: SPORT.NFL,
  teams: SIM_LIBRARY_TEAMS,
  weeks: [WEEK_1],
  games: [
    {
      providerGameId: "cancelled-game-1",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "BUF",
      awayTeamAbbr: "MIA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 0),
      spread: -3,
      finalStatus: SIM_FINAL_STATUS.CANCELLED,
      finalHomeScore: null,
      finalAwayScore: null,
    },
    {
      // 27-13 = home by 14, spread -6: an ordinary cover, unrelated to the
      // cancellation, so a re-pick has a live unstarted game to move to.
      providerGameId: "cancelled-game-2",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "KC",
      awayTeamAbbr: "DEN",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 1),
      spread: -6,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 27,
      finalAwayScore: 13,
    },
    {
      // 27-13 = home by 14, spread -4: also an ordinary cover.
      providerGameId: "cancelled-game-3",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "DAL",
      awayTeamAbbr: "PHI",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 2),
      spread: -4,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 27,
      finalAwayScore: 13,
    },
  ],
};
