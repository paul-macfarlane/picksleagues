import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, survivorPickResults, survivorPicks, survivorState, teams } from "@picksleagues/db";
import {
  GAME_STATUS,
  MEMBER_ROLE,
  LEAGUE_MODE,
  SPORT,
  type LeagueStatus,
  type SurvivorSettings,
} from "@picksleagues/schemas";
import type { Auth } from "../../src/auth";
import { createAuthenticatedUser } from "./auth-helpers";
import {
  DEFAULT_SURVIVOR_SETTINGS,
  insertLeague,
  membersOf,
  SEED_AT,
  seasonIdFor,
  seedSeason,
  type SeededWeek,
} from "./league-helpers";

export interface SeedSurvivorLeagueMemberSpec {
  username?: string;
  displayName?: string;
}

export interface SeedSurvivorLeagueOptions {
  weeks: SeededWeek[];
  /** One spec per member, in order — the first becomes the commissioner. */
  members: SeedSurvivorLeagueMemberSpec[];
  settings?: SurvivorSettings;
  status?: LeagueStatus;
  year?: number;
  leagueName?: string;
}

export interface SeededSurvivorLeague {
  league: Awaited<ReturnType<typeof insertLeague>>;
  seasonId: string;
  leagueSeasonId: string;
  weekIds: Map<string, string>;
  gameIds: Map<string, string[]>;
  teamIds: { home: string; away: string };
  users: Array<Awaited<ReturnType<typeof createAuthenticatedUser>>>;
  members: Map<string, string>;
}

/**
 * Shared arrange step for the Survivor integration suites: a season + Survivor
 * league + N members, bypassing the API — the sibling of `seedPickemLeague`.
 * Settings left undefined fall through to `DEFAULT_SURVIVOR_SETTINGS`, the
 * shape `createLeague` resolves a Survivor request into (ADR-0024).
 */
export async function seedSurvivorLeague(
  db: Db,
  auth: Auth,
  opts: SeedSurvivorLeagueOptions,
): Promise<SeededSurvivorLeague> {
  const {
    weeks,
    members: memberSpecs,
    settings = DEFAULT_SURVIVOR_SETTINGS,
    status,
    year,
    leagueName,
  } = opts;
  const { seasonId, weekIds, gameIds, teamIds } = await seedSeason(db, { year, weeks });
  const users = await Promise.all(
    memberSpecs.map((spec) =>
      createAuthenticatedUser(auth, { username: spec.username, displayName: spec.displayName }),
    ),
  );
  const league = await insertLeague(db, {
    seasonId,
    name: leagueName,
    mode: LEAGUE_MODE.SURVIVOR,
    status,
    settings,
    members: users.map((user, i) => ({
      userId: user.user.id,
      role: i === 0 ? MEMBER_ROLE.COMMISSIONER : MEMBER_ROLE.MEMBER,
    })),
  });
  const members = await membersOf(db, league.id);
  const leagueSeasonId = await seasonIdFor(db, league.id);
  return { league, seasonId, leagueSeasonId, weekIds, gameIds, teamIds, users, members };
}

/**
 * Inserts a Survivor pick directly — for arranging what the endpoint refuses to
 * arrange itself: a prior week's consumed team, or a `released` row settlement
 * would have written after a cancellation.
 */
export async function insertSurvivorPick(
  db: Db,
  opts: {
    leagueSeasonId: string;
    leagueMemberId: string;
    weekId: string;
    gameId: string;
    teamId: string;
    released?: boolean;
  },
) {
  const [pick] = await db
    .insert(survivorPicks)
    .values({
      leagueSeasonId: opts.leagueSeasonId,
      leagueMemberId: opts.leagueMemberId,
      weekId: opts.weekId,
      gameId: opts.gameId,
      teamId: opts.teamId,
      released: opts.released ?? false,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .returning();
  if (!pick) throw new Error("survivor pick insert returned no row");
  return pick;
}

/**
 * Inserts the ledger row settlement would have written. Nothing in the app
 * mints one at join time — absence means alive — so every test that needs an
 * eliminated member arranges it here.
 */
export async function insertSurvivorState(
  db: Db,
  opts: {
    leagueSeasonId: string;
    leagueMemberId: string;
    livesRemaining?: number;
    eliminatedWeekId?: string | null;
    revivedCount?: number;
  },
) {
  const [row] = await db
    .insert(survivorState)
    .values({
      leagueSeasonId: opts.leagueSeasonId,
      leagueMemberId: opts.leagueMemberId,
      livesRemaining: opts.livesRemaining ?? 1,
      eliminatedWeekId: opts.eliminatedWeekId ?? null,
      revivedCount: opts.revivedCount ?? 0,
      updatedAt: SEED_AT,
    })
    .returning();
  if (!row) throw new Error("survivor state insert returned no row");
  return row;
}

/** Every stored pick for one member on a league-season instance. */
export function survivorPicksFor(db: Db, leagueSeasonId: string, leagueMemberId: string) {
  return db
    .select()
    .from(survivorPicks)
    .where(
      and(
        eq(survivorPicks.leagueSeasonId, leagueSeasonId),
        eq(survivorPicks.leagueMemberId, leagueMemberId),
      ),
    );
}

/**
 * Adds a game, by default between two teams nothing else in the fixture uses.
 * `seedSeason` shares one pair across its whole slate, which is fine for
 * Pick'em but caps a Survivor member at two legal picks per season — the team
 * ledger is the mode's central constraint, so a multi-week fixture needs a
 * fresh pair per week. Pass `teams` to reuse an earlier week's pair, which is
 * what arranges the re-pick a cancellation legitimately allows.
 */
export async function seedSurvivorGame(
  db: Db,
  opts: {
    weekId: string;
    kickoffAt: Date;
    teams?: { homeTeamId: string; awayTeamId: string };
  },
): Promise<{ gameId: string; homeTeamId: string; awayTeamId: string }> {
  const pair = opts.teams ?? (await insertTeamPair(db));

  const [game] = await db
    .insert(games)
    .values({
      weekId: opts.weekId,
      providerGameId: randomUUID(),
      homeTeamId: pair.homeTeamId,
      awayTeamId: pair.awayTeamId,
      kickoffAt: opts.kickoffAt,
      status: GAME_STATUS.SCHEDULED,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .returning();
  if (!game) throw new Error("game insert returned no row");

  return { gameId: game.id, ...pair };
}

async function insertTeamPair(db: Db): Promise<{ homeTeamId: string; awayTeamId: string }> {
  const [homeTeam, awayTeam] = await Promise.all(
    ["H", "A"].map(async (side) => {
      const suffix = randomUUID().slice(0, 6);
      const [team] = await db
        .insert(teams)
        .values({
          sport: SPORT.NFL,
          abbreviation: `${side}${suffix}`,
          name: `Team ${side}${suffix}`,
          createdAt: SEED_AT,
          updatedAt: SEED_AT,
        })
        .returning();
      if (!team) throw new Error("team insert returned no row");
      return team;
    }),
  );
  return { homeTeamId: homeTeam!.id, awayTeamId: awayTeam!.id };
}

/** Settlement's graded outcomes for one league-season instance. */
export function survivorPickResultsFor(db: Db, leagueSeasonId: string) {
  return db
    .select()
    .from(survivorPickResults)
    .where(eq(survivorPickResults.leagueSeasonId, leagueSeasonId));
}

/** Settlement's member ledger for one league-season instance. Absence means alive. */
export function survivorStateFor(db: Db, leagueSeasonId: string) {
  return db.select().from(survivorState).where(eq(survivorState.leagueSeasonId, leagueSeasonId));
}
