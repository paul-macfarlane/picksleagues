import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  games,
  leagueMembers,
  leagueSeasons,
  leagues,
  pickemPicks,
  pickemPickResults,
  sportSeasons,
  pickemStandings,
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
  type PickemSettings,
  type PickemPickSide,
  type Sport,
  type SurvivorSettings,
  type WeekType,
} from "@picksleagues/schemas";
import { WEEK1_KICKOFF } from "./league-app";

export const SEED_AT = new Date("2026-01-01T00:00:00.000Z");

export interface SeededWeek {
  weekType?: WeekType;
  weekNumber: number;
  /** Defaults to `SEED_AT` — most callers don't care about the week's own bounds. */
  startsAt?: Date;
  endsAt?: Date;
  /** Kickoffs of the games in this week; empty = week with no games. */
  kickoffs?: Array<{
    kickoffAt: Date;
    overrideKickoffAt?: Date;
    /**
     * The game's current spread — the number every ATS path resolves. Omit for
     * straight-up fixtures, where no spread exists.
     */
    spread?: number;
    /** The book behind `spread` (PKM-9). Omit for fixtures that don't care. */
    spreadSource?: string;
  }>;
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
  // Game ids per week key, in the order their kickoffs were declared — pick
  // tests need to address a specific game, and re-querying for it in every test
  // would just restate the ordering this already knows.
  const gameIds = new Map<string, string[]>();
  for (const spec of weekSpecs) {
    const weekType = spec.weekType ?? WEEK_TYPE.REGULAR;
    const key = `${weekType}:${spec.weekNumber}`;
    const [week] = await db
      .insert(weeks)
      .values({
        seasonId: season.id,
        weekType,
        weekNumber: spec.weekNumber,
        label: `Week ${spec.weekNumber}`,
        startsAt: spec.startsAt ?? SEED_AT,
        endsAt: spec.endsAt ?? SEED_AT,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      })
      .returning();
    if (!week) throw new Error("week insert returned no row");
    weekIds.set(key, week.id);

    const weekGameIds: string[] = [];
    for (const game of spec.kickoffs ?? []) {
      const [inserted] = await db
        .insert(games)
        .values({
          weekId: week.id,
          providerGameId: randomUUID(),
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          kickoffAt: game.kickoffAt,
          overrideKickoffAt: game.overrideKickoffAt ?? null,
          spread: game.spread ?? null,
          spreadSource: game.spreadSource ?? null,
          status: GAME_STATUS.SCHEDULED,
          createdAt: SEED_AT,
          updatedAt: SEED_AT,
        })
        .returning();
      if (!inserted) throw new Error("game insert returned no row");
      weekGameIds.push(inserted.id);
    }
    gameIds.set(key, weekGameIds);
  }

  // The two teams every seeded game is played between. Survivor fixtures need
  // them by id — its ledger is keyed on the team, not the game.
  return {
    seasonId: season.id,
    weekIds,
    gameIds,
    teamIds: { home: homeTeam.id, away: awayTeam.id },
  };
}

export const DEFAULT_PICKEM_SETTINGS: PickemSettings = {
  startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
  endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
  pickType: PICK_TYPE.STRAIGHT_UP,
  picksPerWeek: 5,
};

/**
 * The shape `createLeague` resolves a Survivor request into (ADR-0024) — the
 * regular season, since that is the only range the mode allows. Fixtures that
 * care about a *stale* stored range override `startWeek`.
 */
export const DEFAULT_SURVIVOR_SETTINGS: SurvivorSettings = {
  startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
  endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
};

/** Four unstarted games, spread an hour apart — a slate long enough to exceed a modest Picks Per Week cap. */
export const FOUR_GAME_WEEK: SeededWeek[] = [
  {
    weekNumber: 1,
    kickoffs: [
      { kickoffAt: WEEK1_KICKOFF },
      { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 60 * 60 * 1000) },
      { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 2 * 60 * 60 * 1000) },
      { kickoffAt: new Date(WEEK1_KICKOFF.getTime() + 3 * 60 * 60 * 1000) },
    ],
  },
];

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

/** userId -> leagueMemberId for a league just built by `insertLeague`. */
export async function membersOf(db: Db, leagueId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: leagueMembers.id, userId: leagueMembers.userId })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, leagueId));
  return new Map(rows.map((row) => [row.userId, row.id]));
}

/** The single league-season instance's id for a league seeded with one season. */
export async function seasonIdFor(db: Db, leagueId: string): Promise<string> {
  const [row] = await db
    .select({ id: leagueSeasons.id })
    .from(leagueSeasons)
    .where(eq(leagueSeasons.leagueId, leagueId));
  if (!row) throw new Error(`no league_seasons row for league ${leagueId}`);
  return row.id;
}

/** Inserts a pick row directly — used to arrange settlement/standings fixtures without N pick-submission requests. */
export async function insertPick(
  db: Db,
  opts: {
    leagueSeasonId: string;
    leagueMemberId: string;
    weekId: string;
    gameId: string;
    side: PickemPickSide;
    spreadAtPick?: number | null;
  },
) {
  const [pick] = await db
    .insert(pickemPicks)
    .values({
      leagueSeasonId: opts.leagueSeasonId,
      leagueMemberId: opts.leagueMemberId,
      weekId: opts.weekId,
      gameId: opts.gameId,
      side: opts.side,
      spreadAtPick: opts.spreadAtPick ?? null,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .returning();
  if (!pick) throw new Error("pick insert returned no row");
  return pick;
}

export type GameUpdate = Partial<{
  status: (typeof GAME_STATUS)[keyof typeof GAME_STATUS];
  homeScore: number | null;
  awayScore: number | null;
  spread: number | null;
  period: number | null;
  clockSeconds: number | null;
  overrideStatus: (typeof GAME_STATUS)[keyof typeof GAME_STATUS] | null;
  overrideHomeScore: number | null;
  overrideAwayScore: number | null;
  weekId: string;
}>;

export async function setGame(db: Db, gameId: string, values: GameUpdate) {
  await db.update(games).set(values).where(eq(games.id, gameId));
}

export async function pickResultsFor(db: Db, leagueSeasonId: string) {
  return db
    .select()
    .from(pickemPickResults)
    .where(eq(pickemPickResults.leagueSeasonId, leagueSeasonId));
}

export async function standingsFor(db: Db, leagueSeasonId: string) {
  return db
    .select()
    .from(pickemStandings)
    .where(eq(pickemStandings.leagueSeasonId, leagueSeasonId));
}
