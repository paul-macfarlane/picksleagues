import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { WEEK_1, WEEK_2, kickoffOffsetMs } from "./timing";

/**
 * The starting state for exercising week-move detection (spec §Testing: "week
 * moves"). A move is a game's `week_id` *changing* between two syncs, so it
 * takes two steps and this scenario is step one: load and sync, then
 * `PATCH /sim/fixtures/games/{id}` the moved game's `weekNumber` and sync again
 * — `ingestSeasonSnapshot` repoints the row and reports a week move.
 *
 * `week-move-3` is declared in week 2 while its kickoff sits inside week 1's
 * window, so the fixture also pins the rule that ingestion assigns games by the
 * provider's declared week rather than by kickoff date.
 */
export const weekMoveScenario: SimScenarioDefinition = {
  slug: "week-move",
  name: "Game moved between weeks",
  description: "A game declared as week 2 with a kickoff that falls inside week 1's window.",
  covers: "Week-move detection in schedule sync",
  sport: SPORT.NFL,
  teams: SIM_LIBRARY_TEAMS,
  weeks: [WEEK_1, WEEK_2],
  games: [
    {
      providerGameId: "week-move-1",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "BUF",
      awayTeamAbbr: "MIA",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 0),
      spread: -3,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 24,
      finalAwayScore: 17,
    },
    {
      providerGameId: "week-move-2",
      weekType: WEEK_2.weekType,
      weekNumber: WEEK_2.weekNumber,
      homeTeamAbbr: "KC",
      awayTeamAbbr: "DEN",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_2.startsAtOffsetMs, 0),
      spread: -6,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 27,
      finalAwayScore: 13,
    },
    {
      // A second genuine week-1 game, so moving `week-move-1` out leaves the
      // week with something still in it. Without this the scenario cannot
      // exercise the half of the move that matters to a *member*: a pick that
      // pushed earns a substitute, and a substitute needs an unstarted game to
      // land on. Kicks off last in week 1 so it is still open after the move.
      providerGameId: "week-move-4",
      weekType: WEEK_1.weekType,
      weekNumber: WEEK_1.weekNumber,
      homeTeamAbbr: "SEA",
      awayTeamAbbr: "SF",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 2),
      spread: -2.5,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 17,
      finalAwayScore: 13,
    },
    {
      // Declared week 2, but the kickoff offset (index 1 within week 1's
      // window) sits before week 1 even ends — the moved game.
      providerGameId: "week-move-3",
      weekType: WEEK_2.weekType,
      weekNumber: WEEK_2.weekNumber,
      homeTeamAbbr: "DAL",
      awayTeamAbbr: "PHI",
      kickoffAtOffsetMs: kickoffOffsetMs(WEEK_1.startsAtOffsetMs, 1),
      spread: -4,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: 21,
      finalAwayScore: 14,
    },
  ],
};
