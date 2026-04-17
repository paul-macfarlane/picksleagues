import { and, asc, desc, eq, gt, notInArray, or, sql } from "drizzle-orm";

import type { Transaction } from "@/data/utils";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type {
  DirectInvite,
  League,
  LinkInvite,
  NewDirectInvite,
  NewLinkInvite,
} from "@/lib/db/schema/leagues";
import {
  directInvites,
  leagueMembers,
  leagues,
  linkInvites,
} from "@/lib/db/schema/leagues";
import { profile } from "@/lib/db/schema/profiles";
import type { Profile } from "@/lib/db/schema/profiles";

export async function upsertDirectInvite(
  data: Omit<NewDirectInvite, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<DirectInvite> {
  const client = tx ?? db;
  const [result] = await client
    .insert(directInvites)
    .values(data)
    .onConflictDoUpdate({
      target: [directInvites.leagueId, directInvites.inviteeUserId],
      set: {
        role: data.role,
        expiresAt: data.expiresAt,
        inviterUserId: data.inviterUserId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getDirectInvite(
  leagueId: string,
  inviteeUserId: string,
  tx?: Transaction,
): Promise<DirectInvite | null> {
  const client = tx ?? db;
  const result = await client.query.directInvites.findFirst({
    where: and(
      eq(directInvites.leagueId, leagueId),
      eq(directInvites.inviteeUserId, inviteeUserId),
    ),
  });
  return result ?? null;
}

export async function getDirectInviteById(
  inviteId: string,
  tx?: Transaction,
): Promise<DirectInvite | null> {
  const client = tx ?? db;
  const result = await client.query.directInvites.findFirst({
    where: eq(directInvites.id, inviteId),
  });
  return result ?? null;
}

export async function removeDirectInvite(
  inviteId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  const deleted = await client
    .delete(directInvites)
    .where(eq(directInvites.id, inviteId))
    .returning({ id: directInvites.id });
  if (deleted.length === 0) {
    throw new NotFoundError("Invite not found");
  }
}

export async function removeDirectInvitesByLeague(
  leagueId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  await client
    .delete(directInvites)
    .where(eq(directInvites.leagueId, leagueId));
}

export interface DirectInviteWithContext extends DirectInvite {
  league: League;
  inviter: Profile | null;
}

export async function getPendingDirectInvitesForUser(
  userId: string,
  now: Date,
  tx?: Transaction,
): Promise<DirectInviteWithContext[]> {
  const client = tx ?? db;
  const rows = await client
    .select({
      invite: directInvites,
      league: leagues,
      inviterProfile: profile,
    })
    .from(directInvites)
    .innerJoin(leagues, eq(directInvites.leagueId, leagues.id))
    .leftJoin(profile, eq(directInvites.inviterUserId, profile.userId))
    .where(
      and(
        eq(directInvites.inviteeUserId, userId),
        gt(directInvites.expiresAt, now),
      ),
    )
    .orderBy(desc(directInvites.createdAt));

  return rows.map((row) => ({
    ...row.invite,
    league: row.league,
    inviter: row.inviterProfile,
  }));
}

export async function searchInviteCandidates(
  leagueId: string,
  query: string,
  limit: number,
  tx?: Transaction,
): Promise<Profile[]> {
  const client = tx ?? db;

  const [existingMembers, existingInvites] = await Promise.all([
    client
      .select({ userId: leagueMembers.userId })
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, leagueId)),
    client
      .select({ userId: directInvites.inviteeUserId })
      .from(directInvites)
      .where(eq(directInvites.leagueId, leagueId)),
  ]);

  const excludeUserIds = Array.from(
    new Set([
      ...existingMembers.map((row) => row.userId),
      ...existingInvites.map((row) => row.userId),
    ]),
  );

  const pattern = `%${query}%`;
  const baseWhere = or(
    sql`${profile.username} ILIKE ${pattern}`,
    sql`${profile.name} ILIKE ${pattern}`,
  );
  const whereClause =
    excludeUserIds.length > 0
      ? and(baseWhere, notInArray(profile.userId, excludeUserIds))
      : baseWhere;

  return client
    .select()
    .from(profile)
    .where(whereClause)
    .orderBy(asc(profile.username))
    .limit(limit);
}

export async function insertLinkInvite(
  data: Omit<NewLinkInvite, "id" | "createdAt" | "updatedAt">,
  tx?: Transaction,
): Promise<LinkInvite> {
  const client = tx ?? db;
  const [result] = await client.insert(linkInvites).values(data).returning();
  return result;
}

export async function getLinkInviteById(
  inviteId: string,
  tx?: Transaction,
): Promise<LinkInvite | null> {
  const client = tx ?? db;
  const result = await client.query.linkInvites.findFirst({
    where: eq(linkInvites.id, inviteId),
  });
  return result ?? null;
}

export async function getLinkInviteByToken(
  token: string,
  tx?: Transaction,
): Promise<LinkInvite | null> {
  const client = tx ?? db;
  const result = await client.query.linkInvites.findFirst({
    where: eq(linkInvites.token, token),
  });
  return result ?? null;
}

export async function getLinkInvitesByLeague(
  leagueId: string,
  tx?: Transaction,
): Promise<LinkInvite[]> {
  const client = tx ?? db;
  return client
    .select()
    .from(linkInvites)
    .where(eq(linkInvites.leagueId, leagueId))
    .orderBy(desc(linkInvites.createdAt));
}

export async function removeLinkInvite(
  inviteId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  const deleted = await client
    .delete(linkInvites)
    .where(eq(linkInvites.id, inviteId))
    .returning({ id: linkInvites.id });
  if (deleted.length === 0) {
    throw new NotFoundError("Link invite not found");
  }
}

export async function removeLinkInvitesByLeague(
  leagueId: string,
  tx?: Transaction,
): Promise<void> {
  const client = tx ?? db;
  await client.delete(linkInvites).where(eq(linkInvites.leagueId, leagueId));
}
