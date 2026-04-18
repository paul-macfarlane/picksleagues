import { and, asc, eq, sql } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type {
  LeagueMember,
  LeagueRole,
  NewLeagueMember,
} from "@/lib/db/schema/leagues";
import { leagueMembers, leagues } from "@/lib/db/schema/leagues";
import { profile } from "@/lib/db/schema/profiles";
import type { Profile } from "@/lib/db/schema/profiles";

export async function insertLeagueMember(
  data: Omit<NewLeagueMember, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<LeagueMember> {
  const client = tx ?? db;
  const [result] = await client.insert(leagueMembers).values(data).returning();
  return result;
}

export async function getLeagueMember(
  leagueId: string,
  userId: string,
  tx?: Transaction,
): Promise<LeagueMember | null> {
  const client = tx ?? db;
  const result = await client.query.leagueMembers.findFirst({
    where: and(
      eq(leagueMembers.leagueId, leagueId),
      eq(leagueMembers.userId, userId),
    ),
  });
  return result ?? null;
}

export async function updateLeagueMemberRole(
  leagueId: string,
  userId: string,
  role: NewLeagueMember["role"],
  tx?: Transaction,
): Promise<LeagueMember> {
  const client = tx ?? db;
  const [result] = await client
    .update(leagueMembers)
    .set({ role, updatedAt: new Date() })
    .where(
      and(
        eq(leagueMembers.leagueId, leagueId),
        eq(leagueMembers.userId, userId),
      ),
    )
    .returning();
  if (!result) {
    throw new NotFoundError("League member not found");
  }
  return result;
}

export async function removeLeagueMember(
  leagueId: string,
  userId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  await client
    .delete(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, leagueId),
        eq(leagueMembers.userId, userId),
      ),
    );
}

export interface LeagueMemberWithProfile extends LeagueMember {
  profile: Profile;
}

export async function getLeagueMembersWithProfiles(
  leagueId: string,
  tx?: Transaction,
): Promise<LeagueMemberWithProfile[]> {
  const client = tx ?? db;
  const rows = await client
    .select({
      member: leagueMembers,
      profile: profile,
    })
    .from(leagueMembers)
    .innerJoin(profile, eq(leagueMembers.userId, profile.userId))
    .where(eq(leagueMembers.leagueId, leagueId))
    .orderBy(asc(leagueMembers.createdAt));

  return rows.map((row) => ({
    ...row.member,
    profile: row.profile,
  }));
}

export async function getCommissionerCount(
  leagueId: string,
  tx?: Transaction,
): Promise<number> {
  const client = tx ?? db;
  const rows = await client
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, leagueId),
        eq(leagueMembers.role, "commissioner"),
      ),
    );
  return rows.length;
}

export interface LeagueMembershipSummary {
  leagueId: string;
  leagueName: string;
  role: LeagueRole;
  memberCount: number;
  commissionerCount: number;
}

export async function getLeagueMembershipSummaryForUser(
  userId: string,
  tx?: Transaction,
): Promise<LeagueMembershipSummary[]> {
  const client = tx ?? db;
  const memberCount = sql<number>`(
    SELECT count(*)::int FROM ${leagueMembers} AS inner_lm
    WHERE inner_lm.league_id = ${leagues.id}
  )`;
  const commissionerCount = sql<number>`(
    SELECT count(*)::int FROM ${leagueMembers} AS inner_lm
    WHERE inner_lm.league_id = ${leagues.id}
      AND inner_lm.role = 'commissioner'
  )`;

  return client
    .select({
      leagueId: leagues.id,
      leagueName: leagues.name,
      role: leagueMembers.role,
      memberCount,
      commissionerCount,
    })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagueMembers.leagueId, leagues.id))
    .where(eq(leagueMembers.userId, userId));
}
