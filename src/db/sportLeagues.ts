import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "./client";
import { sportLeagues, sportLeagueSeasons, sportLeagueWeeks } from "./schema";
import { DBSportLeagueWeek } from "@/db/sportLeagueWeeks";
import {
  DBSportLeagueSeason,
  DBSportLeagueSeasonDetail,
} from "@/db/sportLeagueSeason";
import { DBTransaction } from "@/db/transactions";
import { ESPNLeagueSlug, ESPNSportSlug } from "@/integrations/espn/shared";

export interface DBSportLeague {
  id: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
  espnId: string;
  espnSlug: ESPNLeagueSlug;
  espnSportSlug: ESPNSportSlug;
  createdAt: Date;
  updatedAt: Date;
}

export interface DBSportLeagueWithSeasonDetail extends DBSportLeague {
  season: DBSportLeagueSeasonDetail;
}

export async function getDBSportLeagueWithSeasonDetails(
  sportLeagueId: string,
  seasonId: string,
): Promise<DBSportLeagueWithSeasonDetail | null> {
  const queryRows = await db
    .select()
    .from(sportLeagues)
    .innerJoin(
      sportLeagueSeasons,
      eq(sportLeagues.id, sportLeagueSeasons.leagueId),
    )
    .innerJoin(
      sportLeagueWeeks,
      eq(sportLeagueSeasons.id, sportLeagueWeeks.seasonId),
    )
    .where(
      and(
        eq(sportLeagues.id, sportLeagueId),
        eq(sportLeagueSeasons.id, seasonId),
      ),
    )
    .orderBy(sportLeagueWeeks.startTime);
  return queryRows.length
    ? aggregateLeagueSeasonAndWeeksIntoDetails(queryRows)[0]
    : null;
}

export interface DBSportLeagueWithSeasonsDetail extends DBSportLeague {
  seasons: DBSportLeagueSeasonDetail[];
}

export async function getActiveAndNextDBSportLeagueSeasonDetailsWithActiveWeeks(): Promise<
  DBSportLeagueWithSeasonsDetail[]
> {
  const now = new Date();
  const queryRows = await db
    .select()
    .from(sportLeagues)
    .innerJoin(
      sportLeagueSeasons,
      eq(sportLeagues.id, sportLeagueSeasons.leagueId),
    )
    .innerJoin(
      sportLeagueWeeks,
      eq(sportLeagueSeasons.id, sportLeagueWeeks.seasonId),
    )
    .where(
      and(
        gte(sportLeagueSeasons.endTime, now),
        gte(sportLeagueWeeks.startTime, new Date()),
      ),
    )
    .orderBy(sportLeagueWeeks.startTime);

  const dbSportLeagueWithActiveSeasonsDetails: DBSportLeagueWithSeasonsDetail[] =
    [];
  queryRows.forEach((row) => {
    const existingSportDetailIndex =
      dbSportLeagueWithActiveSeasonsDetails.findIndex(
        (detail) => detail.id === row.sports_leagues.id,
      );
    if (existingSportDetailIndex === -1) {
      dbSportLeagueWithActiveSeasonsDetails.push({
        ...row.sports_leagues,
        seasons: [
          {
            ...row.sport_league_seasons,
            weeks: row.sport_league_weeks ? [row.sport_league_weeks] : [],
          },
        ],
      });

      return;
    }

    const existingSportLeagueSeasonIndex =
      dbSportLeagueWithActiveSeasonsDetails[
        existingSportDetailIndex
      ].seasons.findIndex(
        (season) => season.id === row.sport_league_seasons.id,
      );
    if (existingSportLeagueSeasonIndex === -1) {
      dbSportLeagueWithActiveSeasonsDetails[
        existingSportDetailIndex
      ].seasons.push({
        ...row.sport_league_seasons,
        weeks: row.sport_league_weeks ? [row.sport_league_weeks] : [],
      });
      return;
    }

    if (row.sport_league_weeks) {
      dbSportLeagueWithActiveSeasonsDetails[existingSportDetailIndex].seasons[
        existingSportLeagueSeasonIndex
      ].weeks.push(row.sport_league_weeks);
    }
  });

  return dbSportLeagueWithActiveSeasonsDetails;
}

export async function getActiveDBSportLeagueSeasonDetailsWithActiveWeeks(): Promise<
  DBSportLeagueWithSeasonDetail[]
> {
  const now = new Date();
  const queryRows = await db
    .select()
    .from(sportLeagues)
    .innerJoin(
      sportLeagueSeasons,
      eq(sportLeagues.id, sportLeagueSeasons.leagueId),
    )
    .innerJoin(
      sportLeagueWeeks,
      eq(sportLeagueSeasons.id, sportLeagueWeeks.seasonId),
    )
    .where(
      and(
        lte(sportLeagueSeasons.startTime, now),
        gte(sportLeagueSeasons.endTime, now),
        gte(sportLeagueWeeks.startTime, new Date()),
      ),
    )
    .orderBy(sportLeagueWeeks.startTime);

  return aggregateLeagueSeasonAndWeeksIntoDetails(queryRows);
}

export async function getNextDBSportLeagueSeasonDetailsWithWeeks(): Promise<
  DBSportLeagueWithSeasonDetail[]
> {
  const now = new Date();
  const queryRows = await db
    .select()
    .from(sportLeagues)
    .innerJoin(
      sportLeagueSeasons,
      eq(sportLeagues.id, sportLeagueSeasons.leagueId),
    )
    .innerJoin(
      sportLeagueWeeks,
      eq(sportLeagueSeasons.id, sportLeagueWeeks.seasonId),
    )
    .where(gte(sportLeagueSeasons.startTime, now))
    .orderBy(sportLeagueWeeks.startTime);

  return aggregateLeagueSeasonAndWeeksIntoDetails(queryRows);
}

interface LeagueSeasonAndWeekRows {
  sports_leagues: DBSportLeague;
  sport_league_seasons: DBSportLeagueSeason;
  sport_league_weeks: DBSportLeagueWeek;
}

function aggregateLeagueSeasonAndWeeksIntoDetails(
  rows: LeagueSeasonAndWeekRows[],
): DBSportLeagueWithSeasonDetail[] {
  const dbSportLeagueWithActiveSeasonDetails: DBSportLeagueWithSeasonDetail[] =
    [];
  rows.forEach((row) => {
    const existingSportDetailIndex =
      dbSportLeagueWithActiveSeasonDetails.findIndex(
        (detail) => detail.id === row.sports_leagues.id,
      );
    if (existingSportDetailIndex === -1) {
      dbSportLeagueWithActiveSeasonDetails.push({
        ...row.sports_leagues,
        season: {
          ...row.sport_league_seasons,
          weeks: row.sport_league_weeks ? [row.sport_league_weeks] : [],
        },
      });

      return;
    }

    if (row.sport_league_weeks) {
      dbSportLeagueWithActiveSeasonDetails[
        existingSportDetailIndex
      ].season.weeks.push(row.sport_league_weeks);
    }
  });

  return dbSportLeagueWithActiveSeasonDetails;
}

export async function getDBSportLeagueById(
  id: string,
): Promise<DBSportLeague | null> {
  const queryRows = await db
    .select()
    .from(sportLeagues)
    .where(eq(sportLeagues.id, id));
  if (!queryRows.length) {
    return null;
  }

  return queryRows[0];
}

export async function getDBSportLeagueWeekById(
  id: string,
  tx?: DBTransaction,
): Promise<DBSportLeagueWeek | null> {
  const queryRows = tx
    ? await tx
        .select()
        .from(sportLeagueWeeks)
        .where(eq(sportLeagueWeeks.id, id))
    : await db
        .select()
        .from(sportLeagueWeeks)
        .where(eq(sportLeagueWeeks.id, id));
  if (!queryRows.length) {
    return null;
  }

  return queryRows[0];
}

export interface UpsertDBSportLeague {
  name: string;
  abbreviation: string;
  logoUrl: string | null;
  espnId: string;
  espnSlug: ESPNLeagueSlug;
  espnSportSlug: ESPNSportSlug;
}

export async function upsertDBSportLeagues(
  upserts: UpsertDBSportLeague[],
  tx?: DBTransaction,
): Promise<DBSportLeague[]> {
  if (tx) {
    return tx
      .insert(sportLeagues)
      .values(upserts)
      .onConflictDoUpdate({
        target: [sportLeagues.name],
        set: {
          name: sql`excluded.name`,
          abbreviation: sql`excluded.abbreviation`,
          logoUrl: sql`excluded.logo_url`,
          espnId: sql`excluded.espn_id`,
          espnSlug: sql`excluded.espn_slug`,
          espnSportSlug: sql`excluded.espn_sport_slug`,
        },
      })
      .returning();
  } else {
    return db
      .insert(sportLeagues)
      .values(upserts)
      .onConflictDoUpdate({
        target: [sportLeagues.name],
        set: {
          name: sql`excluded.name`,
          abbreviation: sql`excluded.abbreviation`,
          logoUrl: sql`excluded.logo_url`,
          espnId: sql`excluded.espn_id`,
          espnSlug: sql`excluded.espn_slug`,
          espnSportSlug: sql`excluded.espn_sport_slug`,
        },
      })
      .returning();
  }
}

export async function getAllDBSportLeagues(
  tx?: DBTransaction,
): Promise<DBSportLeague[]> {
  return tx ? tx.select().from(sportLeagues) : db.select().from(sportLeagues);
}
