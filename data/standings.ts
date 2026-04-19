import { and, asc, eq } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import type {
  LeagueStanding,
  NewLeagueStanding,
} from "@/lib/db/schema/leagues";
import { leagueStandings } from "@/lib/db/schema/leagues";
import { profile } from "@/lib/db/schema/profiles";
import type { Profile } from "@/lib/db/schema/profiles";
import type { Season } from "@/lib/db/schema/sports";
import { seasons } from "@/lib/db/schema/sports";

export async function insertLeagueStanding(
  data: Omit<NewLeagueStanding, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<LeagueStanding> {
  const client = tx ?? db;
  const [result] = await client
    .insert(leagueStandings)
    .values(data)
    .returning();
  return result;
}

export async function getLeagueStanding(
  leagueId: string,
  userId: string,
  seasonId: string,
  tx?: Transaction,
): Promise<LeagueStanding | null> {
  const client = tx ?? db;
  const result = await client.query.leagueStandings.findFirst({
    where: and(
      eq(leagueStandings.leagueId, leagueId),
      eq(leagueStandings.userId, userId),
      eq(leagueStandings.seasonId, seasonId),
    ),
  });
  return result ?? null;
}

export async function removeLeagueStandingsForUser(
  leagueId: string,
  userId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  await client
    .delete(leagueStandings)
    .where(
      and(
        eq(leagueStandings.leagueId, leagueId),
        eq(leagueStandings.userId, userId),
      ),
    );
}

export interface LeagueStandingWithProfile extends LeagueStanding {
  profile: Profile;
}

export async function getStandingsForLeagueSeasonWithProfiles(
  leagueId: string,
  seasonId: string,
  tx?: Transaction,
): Promise<LeagueStandingWithProfile[]> {
  const client = tx ?? db;
  const rows = await client
    .select({ standing: leagueStandings, profile })
    .from(leagueStandings)
    .innerJoin(profile, eq(leagueStandings.userId, profile.userId))
    .where(
      and(
        eq(leagueStandings.leagueId, leagueId),
        eq(leagueStandings.seasonId, seasonId),
      ),
    )
    .orderBy(asc(leagueStandings.rank), asc(profile.username));
  return rows.map((row) => ({ ...row.standing, profile: row.profile }));
}

export async function getSeasonsWithStandingsForLeague(
  leagueId: string,
  tx?: Transaction,
): Promise<Season[]> {
  const client = tx ?? db;
  const rows = await client
    .selectDistinct({ season: seasons })
    .from(leagueStandings)
    .innerJoin(seasons, eq(leagueStandings.seasonId, seasons.id))
    .where(eq(leagueStandings.leagueId, leagueId))
    .orderBy(asc(seasons.year));
  return rows.map((row) => row.season);
}

export async function upsertLeagueStanding(
  data: Omit<NewLeagueStanding, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<LeagueStanding> {
  const client = tx ?? db;
  const [result] = await client
    .insert(leagueStandings)
    .values(data)
    .onConflictDoUpdate({
      target: [
        leagueStandings.leagueId,
        leagueStandings.userId,
        leagueStandings.seasonId,
      ],
      set: {
        wins: data.wins ?? 0,
        losses: data.losses ?? 0,
        pushes: data.pushes ?? 0,
        points: data.points ?? 0,
        rank: data.rank ?? 1,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}
