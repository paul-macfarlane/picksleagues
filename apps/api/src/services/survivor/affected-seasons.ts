import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, leagueSeasons, leagues, survivorPicks, weeks } from "@picksleagues/db";
import { LEAGUE_MODE, LEAGUE_SETTINGS_SCHEMAS, LEAGUE_STATUS } from "@picksleagues/schemas";
import { isSurvivorRangeWeek } from "./season";

/** Finds Survivor seasons affected directly or through a changed sport-season game. */
export async function loadSurvivorSeasonsAffectedByGames(
  db: Db,
  gameIds: readonly string[],
): Promise<string[]> {
  const directlyAffected = await db
    .selectDistinct({ leagueSeasonId: survivorPicks.leagueSeasonId })
    .from(survivorPicks)
    .where(inArray(survivorPicks.gameId, [...gameIds]));

  const changedWeeks = await db
    .selectDistinct({
      seasonId: weeks.seasonId,
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
    })
    .from(games)
    .innerJoin(weeks, eq(games.weekId, weeks.id))
    .where(inArray(games.id, [...gameIds]));
  const seasonIds = [...new Set(changedWeeks.map((row) => row.seasonId))];
  const activeCandidates =
    seasonIds.length === 0
      ? []
      : await db
          .select({
            leagueSeasonId: leagueSeasons.id,
            seasonId: leagueSeasons.seasonId,
            settings: leagueSeasons.settings,
          })
          .from(leagueSeasons)
          .innerJoin(leagues, eq(leagueSeasons.leagueId, leagues.id))
          .where(
            and(
              eq(leagues.mode, LEAGUE_MODE.SURVIVOR),
              eq(leagueSeasons.status, LEAGUE_STATUS.ACTIVE),
              inArray(leagueSeasons.seasonId, seasonIds),
            ),
          );
  const seasonAffected = activeCandidates.filter((candidate) => {
    const settings = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.SURVIVOR].parse(candidate.settings);
    return changedWeeks.some(
      (week) => week.seasonId === candidate.seasonId && isSurvivorRangeWeek(week, settings),
    );
  });

  return [
    ...new Set([
      ...directlyAffected.map((row) => row.leagueSeasonId),
      ...seasonAffected.map((row) => row.leagueSeasonId),
    ]),
  ];
}
