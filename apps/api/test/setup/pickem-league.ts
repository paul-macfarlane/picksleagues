import type { Db } from "@picksleagues/db";
import { MEMBER_ROLE, type LeagueStatus, type PickemSettings } from "@picksleagues/schemas";
import type { Auth } from "../../src/auth";
import { createAuthenticatedUser } from "./auth-helpers";
import {
  insertLeague,
  membersOf,
  seasonIdFor,
  seedSeason,
  type SeededWeek,
} from "./league-helpers";

export interface SeedPickemLeagueMemberSpec {
  username?: string;
  displayName?: string;
}

export interface SeedPickemLeagueOptions {
  weeks: SeededWeek[];
  /** One spec per member, in order — the first becomes the commissioner. */
  members: SeedPickemLeagueMemberSpec[];
  settings?: PickemSettings;
  status?: LeagueStatus;
  year?: number;
  leagueName?: string;
}

export interface SeededPickemLeague {
  league: Awaited<ReturnType<typeof insertLeague>>;
  seasonId: string;
  leagueSeasonId: string;
  weekIds: Map<string, string>;
  gameIds: Map<string, string[]>;
  users: Array<Awaited<ReturnType<typeof createAuthenticatedUser>>>;
  members: Map<string, string>;
}

/**
 * Shared arrange step for the Pick'em integration suites: a season + league +
 * N members, bypassing the API. Every per-file seed helper across
 * pickem-picks/settlement/pickem-standings/sim-settle.test.ts is a thin
 * parameterization of this shape (custom settings/weeks/status/year/member
 * naming) — settings/status/year left undefined fall through to
 * `insertLeague`/`seedSeason`'s own defaults.
 */
export async function seedPickemLeague(
  db: Db,
  auth: Auth,
  opts: SeedPickemLeagueOptions,
): Promise<SeededPickemLeague> {
  const { weeks, members: memberSpecs, settings, status, year, leagueName } = opts;
  const { seasonId, weekIds, gameIds } = await seedSeason(db, { year, weeks });
  const users = await Promise.all(
    memberSpecs.map((spec) =>
      createAuthenticatedUser(auth, { username: spec.username, displayName: spec.displayName }),
    ),
  );
  const league = await insertLeague(db, {
    seasonId,
    name: leagueName,
    status,
    settings,
    members: users.map((user, i) => ({
      userId: user.user.id,
      role: i === 0 ? MEMBER_ROLE.COMMISSIONER : MEMBER_ROLE.MEMBER,
    })),
  });
  const members = await membersOf(db, league.id);
  const leagueSeasonId = await seasonIdFor(db, league.id);
  return { league, seasonId, leagueSeasonId, weekIds, gameIds, users, members };
}
