import { asc, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagues, users } from "@picksleagues/db";
import {
  MEMBER_ROLE,
  type LeagueMember,
  type LeagueResponse,
  type LeagueSettings,
} from "@picksleagues/schemas";

export type LeagueRow = typeof leagues.$inferSelect;

export async function loadMembers(
  db: Db,
  leagueId: string,
): Promise<Array<{ member: typeof leagueMembers.$inferSelect; user: typeof users.$inferSelect }>> {
  return db
    .select({ member: leagueMembers, user: users })
    .from(leagueMembers)
    .innerJoin(users, eq(leagueMembers.userId, users.id))
    .where(eq(leagueMembers.leagueId, leagueId))
    .orderBy(asc(leagueMembers.createdAt));
}

function serializeMember(row: {
  member: typeof leagueMembers.$inferSelect;
  user: typeof users.$inferSelect;
}): LeagueMember {
  return {
    id: row.member.id,
    userId: row.user.id,
    username: row.user.username,
    displayName: row.user.display_name,
    image: row.user.image,
    role: row.member.role,
    joinedAt: row.member.createdAt.toISOString(),
  };
}

export function serializeLeague(
  league: LeagueRow,
  seasonYear: number,
  settings: LeagueSettings,
  startsAt: Date | null,
  members: Array<{ member: typeof leagueMembers.$inferSelect; user: typeof users.$inferSelect }>,
  viewerId: string,
): LeagueResponse {
  // The viewer is always among `members` (getLeague joins on their own
  // membership; createLeague just inserted it) — the fallback is for types.
  const myRole = members.find((m) => m.user.id === viewerId)?.member.role ?? MEMBER_ROLE.MEMBER;
  return {
    id: league.id,
    name: league.name,
    mode: league.mode,
    visibility: league.visibility,
    status: league.status,
    seasonYear,
    settings,
    startsAt: startsAt ? startsAt.toISOString() : null,
    maxMembers: league.maxMembers,
    myRole,
    members: members.map(serializeMember),
  };
}
