import { randomUUID } from "node:crypto";
import type { Db } from "@picksleagues/db";
import {
  games,
  leagueMembers,
  leagues,
  leagueSettings,
  sportSeasons,
  weeks,
} from "@picksleagues/db";
import {
  GAME_STATUS,
  LEAGUE_MODE,
  LEAGUE_STATUS,
  LEAGUE_VISIBILITY,
  PICK_TYPE,
  SPORT,
  WEEK_TYPE,
  type LeagueMode,
  type LeagueSettings,
  type LeagueStatus,
  type LeagueVisibility,
  type MemberRole,
  type Sport,
  type WeekType,
} from "@picksleagues/schemas";

const SEED_AT = new Date("2026-01-01T00:00:00.000Z");

export interface SeededWeek {
  weekType?: WeekType;
  weekNumber: number;
  /** Kickoffs of the games in this week; empty = week with no games. */
  kickoffs?: Array<{ kickoffAt: Date; overrideKickoffAt?: Date }>;
}

/** Directly inserts a season + weeks + games — league tests don't exercise ingestion. */
export async function seedSeason(
  db: Db,
  {
    sport = SPORT.NFL,
    year = 2026,
    weeks: weekSpecs,
  }: { sport?: Sport; year?: number; weeks: SeededWeek[] },
) {
  const [season] = await db
    .insert(sportSeasons)
    .values({ sport, year, createdAt: SEED_AT, updatedAt: SEED_AT })
    .returning();
  if (!season) throw new Error("season insert returned no row");

  const weekIds = new Map<string, string>();
  for (const spec of weekSpecs) {
    const weekType = spec.weekType ?? WEEK_TYPE.REGULAR;
    const [week] = await db
      .insert(weeks)
      .values({
        seasonId: season.id,
        weekType,
        weekNumber: spec.weekNumber,
        label: `Week ${spec.weekNumber}`,
        startsAt: SEED_AT,
        endsAt: SEED_AT,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      })
      .returning();
    if (!week) throw new Error("week insert returned no row");
    weekIds.set(`${weekType}:${spec.weekNumber}`, week.id);

    for (const game of spec.kickoffs ?? []) {
      await db.insert(games).values({
        weekId: week.id,
        providerGameId: randomUUID(),
        homeTeamAbbr: "HOM",
        homeTeamName: "Home Team",
        awayTeamAbbr: "AWY",
        awayTeamName: "Away Team",
        kickoffAt: game.kickoffAt,
        overrideKickoffAt: game.overrideKickoffAt ?? null,
        status: GAME_STATUS.SCHEDULED,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      });
    }
  }

  return { seasonId: season.id, weekIds };
}

export const DEFAULT_PICKEM_SETTINGS: LeagueSettings = {
  startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
  endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
  pickType: PICK_TYPE.STRAIGHT_UP,
  picksPerWeek: 5,
  pushTieResolution: "half_point",
};

/**
 * Directly inserts a league + settings + members, bypassing the API — for
 * arranging preconditions (cap counts, join targets) without N requests.
 */
export async function insertLeague(
  db: Db,
  {
    seasonId,
    name = "Test League",
    mode = LEAGUE_MODE.PICKEM,
    visibility = LEAGUE_VISIBILITY.PRIVATE,
    status = LEAGUE_STATUS.ACTIVE,
    maxMembers = 100,
    settings = DEFAULT_PICKEM_SETTINGS,
    members = [],
  }: {
    seasonId: string;
    name?: string;
    mode?: LeagueMode;
    visibility?: LeagueVisibility;
    status?: LeagueStatus;
    maxMembers?: number;
    settings?: LeagueSettings;
    members?: Array<{ userId: string; role: MemberRole }>;
  },
) {
  const [league] = await db
    .insert(leagues)
    .values({
      name,
      mode,
      visibility,
      status,
      seasonId,
      maxMembers,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .returning();
  if (!league) throw new Error("league insert returned no row");

  await db
    .insert(leagueSettings)
    .values({ leagueId: league.id, settings, createdAt: SEED_AT, updatedAt: SEED_AT });

  for (const member of members) {
    await db.insert(leagueMembers).values({
      leagueId: league.id,
      userId: member.userId,
      role: member.role,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    });
  }

  return league;
}
