import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { WEEK_1, kickoffOffsetMs } from "./timing";

/**
 * Exercises the SU tie and the ATS pick'em push, which are distinct rules
 * that happen to coincide when spread is 0 (spec §Pick'em Modes: "Push/Tie
 * Resolution ... on an ATS push or SU tie").
 */
export const tieGameScenario: SimScenarioDefinition = {
  slug: "tie-game",
  name: "Straight-up tie and pick'em push",
  description:
    "A straight-up tie with a non-zero spread, plus a spread-0 game that ties and pushes at once.",
  covers: "SU tie handling and the spread-0 ATS push case",
  sport: SPORT.NFL,
  teams: SIM_LIBRARY_TEAMS,
  weeks: [WEEK_1],
  games: [
    {
      // 20-20 = SU tie. Spread -3 means margin (0) != -spread (3), so this is
      // an SU tie without also being an ATS push (the underdog covers).
      providerGameId: "tie-game-1",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "BUF",
      awayTeamAbbr: "MIA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 0),
      spread: -3,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 20,
      finalAwayScore: 20,
    },
    {
      // 17-17 with spread 0 (pick'em): margin (0) equals -spread (0), so this
      // game is simultaneously an SU tie and an ATS push.
      providerGameId: "tie-game-2",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "DAL",
      awayTeamAbbr: "PHI",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 1),
      spread: 0,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 17,
      finalAwayScore: 17,
    },
  ],
};
