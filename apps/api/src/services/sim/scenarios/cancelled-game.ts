import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { WEEK_1, kickoffOffsetMs } from "./timing";

/**
 * A cancelled game alongside normal ones (spec §Cancellations & Postponements:
 * "the pick resolves as a push, and the push **stands** — there is no
 * substitute pick, whether or not unstarted games remain in the week").
 *
 * The two ordinary games are what make that provable rather than incidental:
 * the cancellation happens with later kickoffs still ahead of it, which is the
 * exact state the deleted substitute flow keyed on, and the push holds anyway
 * (ADR-0018 decision 3). A single-game week would have proved nothing, since
 * there would have been nothing to substitute into either way.
 */
export const cancelledGameScenario: SimScenarioDefinition = {
  slug: "cancelled-game",
  name: "Cancelled game",
  description: "One cancelled game with null scores in a week of otherwise normal games.",
  covers: "Cancellation-as-push, and that the push stands with games left in the week",
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
      // 27-13 = home by 14, spread -6: margin (14) > -spread (6), an ordinary
      // cover unrelated to the cancellation. Kicks off after it, so the week
      // still holds unstarted games when the push lands.
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
      // 27-13 = home by 14, spread -4: margin (14) > -spread (4), also an
      // ordinary cover, and the last kickoff of the week.
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
