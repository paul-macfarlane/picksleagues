import { SIM_FINAL_STATUS, SPORT } from "@picksleagues/schemas";
import type { SimGameDef, SimScenarioDefinition } from "../definition";
import { SIM_LIBRARY_TEAMS } from "./teams";
import { kickoffOffsetMs, regularSeasonWeek } from "./timing";

/**
 * A Survivor season short enough to play to its end (spec §Game Mode 2;
 * §End of League), and the only library scenario that spans more than one week.
 *
 * **Why four weeks, and why weeks 15–18.** A Survivor league's range is the
 * whole regular season (ADR-0024), and the board only names a winner once every
 * in-range week has been played (`isSeasonConcluded`, `survivor/standings.ts`) —
 * so a league created in week 1 would need all eighteen weeks played before
 * anyone can be crowned. The resolution rule advances a league's start week past
 * any week already under way (ADR-0020 §The mid-week resolution rule), so a
 * season whose ingested weeks begin at 15 resolves to a 15–18 range: four weeks,
 * which is the shortest run that holds an elimination, a revival, and a
 * conclusion in that order.
 *
 * **What each week is for**, and why the results are the exact ones below —
 * `e2e/survivor-journey.sim.spec.ts` (backlog ELM-5) walks them in order:
 *
 * | Week | Winners                 | The rule it exercises                        |
 * |------|-------------------------|----------------------------------------------|
 * | 15   | BUF, KC, DAL, **SEA**   | one member rides SF and goes out              |
 * | 16   | MIA, **DEN**, DAL, SF   | a survivor changes PHI → DEN before kickoff;  |
 * |      |                         | PHI loses, so a change that didn't stick ends |
 * |      |                         | that member's season instead of passing quietly |
 * | 17   | **MIA**, KC, **PHI**, SF| BUF and DAL both lose, so the whole alive set |
 * |      |                         | busts and the revival rule brings them back   |
 * | 18   | BUF, DEN, DAL, SF       | safe picks all round, so the season concludes |
 * |      |                         | with co-winners                               |
 *
 * Spreads are carried for realism only: Survivor is straight-up (ADR-0026) and
 * nothing here consults them.
 */

const WEEKS = [
  regularSeasonWeek(15, 0),
  regularSeasonWeek(16, 1),
  regularSeasonWeek(17, 2),
  regularSeasonWeek(18, 3),
];

/**
 * The same four matchups every week, so a member's ledger of burned teams is
 * what constrains their choices rather than an accident of who happens to be
 * scheduled — which is the rule a whole-season fixture exists to exercise.
 */
const MATCHUPS = [
  { homeTeamAbbr: "BUF", awayTeamAbbr: "MIA" },
  { homeTeamAbbr: "KC", awayTeamAbbr: "DEN" },
  { homeTeamAbbr: "DAL", awayTeamAbbr: "PHI" },
  { homeTeamAbbr: "SF", awayTeamAbbr: "SEA" },
] as const;

/** Per week, per matchup (in `MATCHUPS` order): the home-relative spread and the final score. */
const WEEK_LINES: ReadonlyArray<
  ReadonlyArray<{ spread: number; homeScore: number; awayScore: number }>
> = [
  [
    { spread: -3, homeScore: 27, awayScore: 17 },
    { spread: -6, homeScore: 24, awayScore: 20 },
    { spread: -2, homeScore: 24, awayScore: 20 },
    { spread: -9, homeScore: 16, awayScore: 23 },
  ],
  [
    { spread: -3, homeScore: 20, awayScore: 24 },
    { spread: -6, homeScore: 17, awayScore: 27 },
    { spread: -2, homeScore: 24, awayScore: 20 },
    { spread: -7, homeScore: 30, awayScore: 13 },
  ],
  [
    { spread: -3, homeScore: 17, awayScore: 24 },
    { spread: -4, homeScore: 24, awayScore: 20 },
    { spread: -4, homeScore: 13, awayScore: 21 },
    { spread: -7, homeScore: 28, awayScore: 14 },
  ],
  [
    { spread: -3, homeScore: 21, awayScore: 14 },
    { spread: 3, homeScore: 20, awayScore: 24 },
    { spread: -4, homeScore: 27, awayScore: 17 },
    { spread: -6, homeScore: 24, awayScore: 10 },
  ],
];

const games: SimGameDef[] = WEEKS.flatMap((week, weekIndex) =>
  MATCHUPS.map((matchup, gameIndex) => {
    const line = WEEK_LINES[weekIndex]![gameIndex]!;
    return {
      providerGameId: `survivor-season-${week.weekNumber}-${gameIndex + 1}`,
      weekType: week.weekType,
      weekNumber: week.weekNumber,
      homeTeamAbbr: matchup.homeTeamAbbr,
      awayTeamAbbr: matchup.awayTeamAbbr,
      kickoffAtOffsetMs: kickoffOffsetMs(week.startsAtOffsetMs, gameIndex),
      spread: line.spread,
      finalStatus: SIM_FINAL_STATUS.FINAL,
      finalHomeScore: line.homeScore,
      finalAwayScore: line.awayScore,
    };
  }),
);

export const survivorSeasonScenario: SimScenarioDefinition = {
  slug: "survivor-season",
  name: "Survivor season (weeks 15-18)",
  description:
    "A four-week Survivor run: one member busts in the first week, the whole alive set busts in the third and is revived, and the last week leaves co-winners.",
  covers: "A Survivor season played end to end — elimination, revival, conclusion",
  sport: SPORT.NFL,
  teams: SIM_LIBRARY_TEAMS,
  weeks: WEEKS,
  games,
};
