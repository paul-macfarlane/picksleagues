import {
  oddsProviders,
  picksLeagueMembers,
  picksLeaguePicks,
  picksLeagueSeasons,
  sportLeagueGameOdds,
  sportLeagueGames,
  sportLeagueSeasons,
  sportLeagueTeams,
  sportLeagueWeeks,
  users,
} from "@/db/schema";
import {
  aliasedTable,
  and,
  eq,
  getTableColumns,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "@/db/client";
import { DBTransaction } from "@/db/transactions";
import { DBSportLeagueGame } from "@/db/sportLeagueGames";
import {
  DBOddsProvider,
  DBSportLeagueGameOddsWithProvider,
} from "@/db/sportLeagueGameOdds";
import { DBPicksLeaguePick } from "@/db/picksLeaguesPicks";
import { DBSportLeagueTeam } from "@/db/sportLeagueTeams";
import { DBUser } from "@/db/users";
import { SportLeagueWeekTypes } from "@/models/sportLeagueWeeks";

export interface DBSportLeagueWeek {
  id: string;
  name: string;
  startTime: Date;
  endTime: Date;
  seasonId: string;
  espnEventsRef: string;
  type: SportLeagueWeekTypes;
  manual: boolean;
  pickLockTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

export async function getActiveDBSportLeagueWeeks(
  tx?: DBTransaction,
): Promise<DBSportLeagueWeek[]> {
  const now = new Date();
  let queryRows;
  if (tx) {
    queryRows = await tx
      .select()
      .from(sportLeagueWeeks)
      .where(
        and(
          lte(sportLeagueWeeks.startTime, now),
          gte(sportLeagueWeeks.endTime, now),
        ),
      );
    return queryRows;
  } else {
    queryRows = await db
      .select()
      .from(sportLeagueWeeks)
      .where(
        and(
          lte(sportLeagueWeeks.startTime, now),
          gte(sportLeagueWeeks.endTime, now),
        ),
      );
    return queryRows;
  }
}

export async function getCurrentDBSportLeagueWeek(
  sportLeagueId: string,
): Promise<DBSportLeagueWeek | null> {
  const now = new Date();
  const queryRows = await db
    .select({ week: getTableColumns(sportLeagueWeeks) })
    .from(sportLeagueWeeks)
    .innerJoin(
      sportLeagueSeasons,
      eq(sportLeagueSeasons.id, sportLeagueWeeks.seasonId),
    )
    .where(
      and(
        lte(sportLeagueWeeks.startTime, now),
        gte(sportLeagueWeeks.endTime, now),
        eq(sportLeagueSeasons.leagueId, sportLeagueId),
      ),
    );

  return queryRows.length ? queryRows[0].week : null;
}

export interface UpsertDBSportLeagueWeek {
  seasonId: string;
  name: string;
  startTime: Date;
  endTime: Date;
  espnEventsRef: string;
  type: SportLeagueWeekTypes;
  pickLockTime: Date;
}

export async function upsertDBSportLeagueWeeks(
  upserts: UpsertDBSportLeagueWeek[],
  tx: DBTransaction,
): Promise<DBSportLeagueWeek[]> {
  if (tx) {
    return tx
      .insert(sportLeagueWeeks)
      .values(upserts)
      .onConflictDoUpdate({
        target: [sportLeagueWeeks.seasonId, sportLeagueWeeks.name],
        set: {
          startTime: sql`excluded.start_time`,
          endTime: sql`excluded.end_time`,
          espnEventsRef: sql`excluded.espn_events_ref`,
          type: sql`excluded.type`,
          pickLockTime: sql`excluded.pick_lock_time`,
        },
        setWhere: sql`manual = false`,
      })
      .returning();
  } else {
    return db
      .insert(sportLeagueWeeks)
      .values(upserts)
      .onConflictDoUpdate({
        target: [sportLeagueWeeks.seasonId, sportLeagueWeeks.name],
        set: {
          startTime: sql`excluded.start_time`,
          endTime: sql`excluded.end_time`,
          espnEventsRef: sql`excluded.espn_events_ref`,
          type: sql`excluded.type`,
          pickLockTime: sql`excluded.pick_lock_time`,
        },
        setWhere: sql`manual = false`,
      })
      .returning();
  }
}

export interface DbWeeklyPickGameData extends DBSportLeagueGame {
  odds: DBSportLeagueGameOddsWithProvider[];
  userPick: DBPicksLeaguePick | null;
  awayTeam: DBSportLeagueTeam;
  homeTeam: DBSportLeagueTeam;
}

export interface DBWeeklyPickData extends DBSportLeagueWeek {
  games: DbWeeklyPickGameData[];
}

export async function getUserDBWeeklyPickData(
  picksLeagueId: string,
  sportsLeagueWeekId: string,
  userId: string,
): Promise<DBWeeklyPickData | null> {
  const awayTeamAlias = aliasedTable(sportLeagueTeams, "awaitTeamAlias");
  const homeTeamAlias = aliasedTable(sportLeagueTeams, "homeTeamAlias");

  const queryRows = await db
    .select({
      sportLeagueWeek: getTableColumns(sportLeagueWeeks),
      sportLeagueGame: getTableColumns(sportLeagueGames),
      awayTeamAlias: getTableColumns(awayTeamAlias),
      homeTeamAlias: getTableColumns(homeTeamAlias),
      sportLeagueGameOdds: getTableColumns(sportLeagueGameOdds),
      oddsProviders: getTableColumns(oddsProviders),
    })
    .from(sportLeagueWeeks)
    .innerJoin(
      sportLeagueGames,
      eq(sportLeagueGames.weekId, sportLeagueWeeks.id),
    )
    .innerJoin(awayTeamAlias, eq(awayTeamAlias.id, sportLeagueGames.awayTeamId))
    .innerJoin(homeTeamAlias, eq(homeTeamAlias.id, sportLeagueGames.homeTeamId))
    .innerJoin(
      sportLeagueGameOdds,
      eq(sportLeagueGameOdds.gameId, sportLeagueGames.id),
    )
    .innerJoin(
      oddsProviders,
      eq(oddsProviders.id, sportLeagueGameOdds.providerId),
    )
    .where(eq(sportLeagueWeeks.id, sportsLeagueWeekId))
    .orderBy(sportLeagueGames.startTime);
  if (!queryRows.length) {
    return null;
  }

  const week = queryRows[0].sportLeagueWeek;
  const games: DbWeeklyPickGameData[] = [];
  for (const row of queryRows) {
    const indexOfGame = games.findIndex(
      (game) => game.id === row.sportLeagueGame.id,
    );
    if (indexOfGame === -1) {
      games.push({
        ...row.sportLeagueGame,
        awayTeam: row.awayTeamAlias,
        homeTeam: row.homeTeamAlias,
        odds: [{ ...row.sportLeagueGameOdds, provider: row.oddsProviders }],
        userPick: null, // may be added later
      });
    } else {
      games[indexOfGame].odds.push({
        ...row.sportLeagueGameOdds,
        provider: row.oddsProviders,
      });
    }
  }

  const picksQueryRows = await db
    .select()
    .from(picksLeaguePicks)
    .where(
      and(
        eq(picksLeaguePicks.leagueId, picksLeagueId),
        eq(picksLeaguePicks.userId, userId),
        eq(picksLeaguePicks.sportLeagueWeekId, week.id),
      ),
    );

  for (const row of picksQueryRows) {
    const gameIndex = games.findIndex(
      (game) => game.id === row.sportLeagueGameId,
    );
    if (gameIndex !== -1) {
      games[gameIndex].userPick = row;
    }
  }

  return {
    ...week,
    games,
  };
}

export interface DBWeeklyPickDataByUserGame extends DBSportLeagueGame {
  oddsProvider: DBOddsProvider;
  userPick: DBPicksLeaguePick;
  awayTeam: DBSportLeagueTeam;
  homeTeam: DBSportLeagueTeam;
}

export interface DBWeeklyPickDataByUser extends DBUser {
  games: DBWeeklyPickDataByUserGame[];
}

export async function getLeagueDBWeeklyPickDataByUser(
  picksLeagueId: string,
  sportsLeagueWeekId: string,
): Promise<DBWeeklyPickDataByUser[]> {
  const awayTeamAlias = aliasedTable(sportLeagueTeams, "awaitTeamAlias");
  const homeTeamAlias = aliasedTable(sportLeagueTeams, "homeTeamAlias");

  const queryRows = await db
    .select({
      user: getTableColumns(users),
      pick: getTableColumns(picksLeaguePicks),
      game: getTableColumns(sportLeagueGames),
      awayTeam: getTableColumns(awayTeamAlias),
      homeTeam: getTableColumns(homeTeamAlias),
      oddsProvider: getTableColumns(oddsProviders),
    })
    .from(picksLeagueMembers)
    .innerJoin(users, eq(users.id, picksLeaguePicks.userId))
    .leftJoin(
      picksLeaguePicks,
      eq(picksLeaguePicks.userId, picksLeagueMembers.userId),
    )
    .innerJoin(
      sportLeagueGames,
      eq(sportLeagueGames.id, picksLeaguePicks.sportLeagueGameId),
    )
    .innerJoin(awayTeamAlias, eq(awayTeamAlias.id, sportLeagueGames.awayTeamId))
    .innerJoin(homeTeamAlias, eq(homeTeamAlias.id, sportLeagueGames.homeTeamId))
    .innerJoin(
      sportLeagueGameOdds,
      eq(sportLeagueGameOdds.gameId, sportLeagueGames.id),
    )
    .innerJoin(
      oddsProviders,
      eq(oddsProviders.id, sportLeagueGameOdds.providerId),
    )
    .where(
      and(
        eq(picksLeaguePicks.sportLeagueWeekId, sportsLeagueWeekId),
        eq(picksLeaguePicks.leagueId, picksLeagueId),
      ),
    );

  const userPickData: DBWeeklyPickDataByUser[] = [];
  queryRows.forEach((row) => {
    const indexOfUser = userPickData.findIndex(
      (user) => user.id === row.user.id,
    );
    if (indexOfUser === -1) {
      userPickData.push({
        ...row.user,
        games:
          row.game && row.pick
            ? [
                {
                  ...row.game,
                  userPick: row.pick,
                  awayTeam: row.awayTeam,
                  homeTeam: row.homeTeam,
                  oddsProvider: row.oddsProvider,
                },
              ]
            : [],
      });
    } else if (row.game && row.pick) {
      const indexOfGame = userPickData[indexOfUser].games.findIndex(
        (game) => game.id === row.game.id,
      );
      if (indexOfGame == -1) {
        userPickData[indexOfUser].games.push({
          ...row.game,
          userPick: row.pick,
          awayTeam: row.awayTeam,
          homeTeam: row.homeTeam,
          oddsProvider: row.oddsProvider,
        });
      }
    }
  });

  return userPickData;
}

export async function getDBSportLeagueWeeksForPicksLeagueSeason(
  picksLeagueSeasonId: string,
): Promise<DBSportLeagueWeek[]> {
  const startSportLeagueWeekAlias = aliasedTable(
    sportLeagueWeeks,
    "startSportLeagueWeekAlias",
  );
  const endSportLeagueWeekAlias = aliasedTable(
    sportLeagueWeeks,
    "endSportLeagueWeekAlias",
  );

  const queryRows = await db
    .select({
      sportLeagueWeek: getTableColumns(sportLeagueWeeks),
    })
    .from(picksLeagueSeasons)
    .innerJoin(
      startSportLeagueWeekAlias,
      eq(
        startSportLeagueWeekAlias.id,
        picksLeagueSeasons.startSportLeagueWeekId,
      ),
    )
    .innerJoin(
      endSportLeagueWeekAlias,
      eq(endSportLeagueWeekAlias.id, picksLeagueSeasons.endSportLeagueWeekId),
    )
    .innerJoin(
      sportLeagueWeeks,
      eq(picksLeagueSeasons.sportLeagueSeasonId, sportLeagueWeeks.seasonId),
    )
    .where(
      and(
        eq(picksLeagueSeasons.id, picksLeagueSeasonId),
        gte(sportLeagueWeeks.startTime, startSportLeagueWeekAlias.startTime),
        lte(sportLeagueWeeks.endTime, endSportLeagueWeekAlias.endTime),
      ),
    );

  return queryRows.map((row) => row.sportLeagueWeek);
}

export interface DBStartAndEndWeek {
  startWeek: DBSportLeagueWeek;
  endWeek: DBSportLeagueWeek;
}

export async function getDBStartAndEndWeekForLeagueActiveSeason(
  picksLeagueId: string,
): Promise<DBStartAndEndWeek | null> {
  const startWeekAlias = aliasedTable(sportLeagueWeeks, "startWeekAlias");
  const endWeekAlias = aliasedTable(sportLeagueWeeks, "endWeekAlias");
  const now = new Date();

  const queryRows = await db
    .select({
      startWeek: getTableColumns(startWeekAlias),
      endWeek: getTableColumns(endWeekAlias),
    })
    .from(picksLeagueSeasons)
    .innerJoin(
      startWeekAlias,
      eq(startWeekAlias.id, picksLeagueSeasons.startSportLeagueWeekId),
    )
    .innerJoin(
      endWeekAlias,
      eq(endWeekAlias.id, picksLeagueSeasons.endSportLeagueWeekId),
    )
    .where(
      and(
        eq(picksLeagueSeasons.leagueId, picksLeagueId),
        lte(startWeekAlias.startTime, now),
        gte(endWeekAlias.endTime, now),
      ),
    );

  return queryRows.length > 0 ? queryRows[0] : null;
}

export async function getDBSportLeagueWeeksForSportLeagueSeason(
  sportLeagueSeasonId: string,
  tx?: DBTransaction,
): Promise<DBSportLeagueWeek[]> {
  const queryRows = tx
    ? await tx
        .select()
        .from(sportLeagueWeeks)
        .where(eq(sportLeagueWeeks.seasonId, sportLeagueSeasonId))
    : await db
        .select()
        .from(sportLeagueWeeks)
        .where(eq(sportLeagueWeeks.seasonId, sportLeagueSeasonId));

  return queryRows;
}
