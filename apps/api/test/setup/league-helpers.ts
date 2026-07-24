import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  games,
  leagueMembers,
  leagueSeasons,
  leagues,
  sportSeasons,
  teams,
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
    provisional = false,
  }: { sport?: Sport; year?: number; weeks: SeededWeek[]; provisional?: boolean },
) {
  const [season] = await db
    .insert(sportSeasons)
    .values({ sport, year, provisional, createdAt: SEED_AT, updatedAt: SEED_AT })
    .returning();
  if (!season) throw new Error("season insert returned no row");

  // Teams are reference data shared across seasons, not per-season (ADR-0010)
  // — seedSeason runs multiple times per sport in some tests (renewal /
  // multi-season fixtures), so this upserts on (sport, abbreviation) rather
  // than blind-inserting a row that would collide on a second call. The
  // abbreviation unique is a partial index scoped to provider-id-less rows
  // (SF-4 amendment: ESPN's placeholder "TBD" teams share an abbreviation
  // across distinct provider ids) — `targetWhere` must restate that predicate
  // for Postgres to infer this as the conflict arbiter.
  const [homeTeam] = await db
    .insert(teams)
    .values({
      sport,
      abbreviation: "HOM",
      name: "Home Team",
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .onConflictDoUpdate({
      target: [teams.sport, teams.abbreviation],
      targetWhere: sql`${teams.providerTeamId} is null`,
      set: { updatedAt: SEED_AT },
    })
    .returning();
  const [awayTeam] = await db
    .insert(teams)
    .values({
      sport,
      abbreviation: "AWY",
      name: "Away Team",
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .onConflictDoUpdate({
      target: [teams.sport, teams.abbreviation],
      targetWhere: sql`${teams.providerTeamId} is null`,
      set: { updatedAt: SEED_AT },
    })
    .returning();
  if (!homeTeam || !awayTeam) throw new Error("team insert returned no row");

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
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
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
 * Directly inserts a league + one season instance + members, bypassing the API
 * — for arranging preconditions (cap counts, join targets) without N requests.
 * `status`/`seasonId`/`settings` land on the instance now (ADR-0009).
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
      maxMembers,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .returning();
  if (!league) throw new Error("league insert returned no row");

  await db.insert(leagueSeasons).values({
    leagueId: league.id,
    seasonId,
    settings,
    status,
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  });

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
