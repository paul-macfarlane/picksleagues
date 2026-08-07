import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { WEEK_1, kickoffOffsetMs } from "./timing";

/**
 * Exercises the SU tie and the ATS pick'em push, which are distinct rules that
 * happen to coincide when the spread is 0. Both score the same fixed 0.5
 * (spec §Game Mode 1 — Scoring); ADR-0018 decision 4 removed the Push/Tie
 * Resolution setting that used to make a Pick'em league's answer configurable,
 * so there is one outcome to check here rather than a matrix.
 */
export const tieGameScenario: SimScenarioDefinition = {
  slug: "tie-game",
  name: "Straight-up tie and pick'em push",
  description:
    "A straight-up tie with a non-zero spread, plus a spread-0 game that ties and pushes at once.",
  covers: "SU tie and spread-0 ATS push, both scoring the fixed 0.5",
  sport: SPORT.NFL,
  teams: SIM_LIBRARY_TEAMS,
  weeks: [WEEK_1],
  games: [
    {
      // 20-20 = SU tie, so an SU league scores 0.5 either side. Spread -3 means
      // margin (0) != -spread (3), so an ATS league grades it normally instead:
      // the underdog covers by 3, taking 1 point, and home takes 0.
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
      // game is simultaneously an SU tie and an ATS push — 0.5 either side in
      // either pick type, by the two rules independently agreeing.
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
