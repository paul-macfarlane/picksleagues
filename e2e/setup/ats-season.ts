import { createDb } from "../../packages/db/src/client";
import { FixedClock } from "../../packages/core/src/clock";
import { SIM_FINAL_STATUS, SIM_SCENARIO_SOURCE, SPORT } from "../../packages/schemas/src/index";
import { materializeDefinition, writeScenario } from "../../apps/api/src/services/sim/definition";
import { SIM_LIBRARY_TEAMS } from "../../apps/api/src/services/sim/scenarios/teams";
import {
  kickoffOffsetMs,
  regularSeasonWeek,
} from "../../apps/api/src/services/sim/scenarios/timing";
import { loadE2eEnv } from "./e2e-env";

/** Six distinct matchups leave one game unselected when the five-pick cap is full. */
export const ATS_MATCHUPS = [
  ["MIA", "BUF"],
  ["DEN", "KC"],
  ["PHI", "DAL"],
  ["SEA", "SF"],
  ["ARI", "ATL"],
  ["BAL", "CIN"],
] as const;

/**
 * Test-only provider fixture: two weeks, six games each. No product tables are
 * seeded; ordinary sync jobs must ingest and settle everything the browser sees.
 * Home picks in week 1 yield W/W/W/L/P (3.5), week 2 L/L/L/W/P (1.5).
 * The first week's BUF line moves -3 → -7 before acceptance, then -14 after it:
 * a ten-point victory wins at the accepted line and loses at the later line.
 */
export async function seedAtsSeason(): Promise<string> {
  const db = createDb(loadE2eEnv().databaseUrl);
  const anchor = new Date("2026-09-01T12:00:00Z");
  const weeks = [regularSeasonWeek(1, 0), regularSeasonWeek(2, 1)];
  const slug = "e2e-ats-two-weeks";
  try {
    await writeScenario(
      db,
      new FixedClock(anchor),
      materializeDefinition(
        {
          slug,
          name: "E2E ATS two weeks",
          description: "Weekly ATS browser journey",
          covers: "Accepted spreads and cumulative standings",
          sport: SPORT.NFL,
          teams: [
            ...SIM_LIBRARY_TEAMS,
            ...["ARI", "ATL", "BAL", "CIN"].map((abbreviation) => ({
              providerTeamId: `e2e-${abbreviation}`,
              abbreviation,
              name: abbreviation,
              location: abbreviation,
              logoLightUrl: null,
              logoDarkUrl: null,
            })),
          ],
          weeks,
          games: weeks.flatMap((week, weekIndex) =>
            ATS_MATCHUPS.map(([away, home], index) => ({
              providerGameId: `e2e-ats-${week.weekNumber}-${index}`,
              weekType: week.weekType,
              weekNumber: week.weekNumber,
              homeTeamAbbr: home,
              awayTeamAbbr: away,
              kickoffAtOffsetMs: kickoffOffsetMs(week.startsAtOffsetMs, index),
              spread: [-3, -3, 2, -7, -3, -3][index]!,
              finalStatus: SIM_FINAL_STATUS.FINAL,
              finalHomeScore: (weekIndex === 0
                ? [30, 27, 24, 24, 23, 27]
                : [20, 20, 17, 30, 23, 27])[index]!,
              finalAwayScore: 20,
            })),
          ),
        },
        anchor,
        2026,
        SIM_SCENARIO_SOURCE.LIBRARY,
      ),
    );
    return slug;
  } finally {
    await db.$client.end();
  }
}
