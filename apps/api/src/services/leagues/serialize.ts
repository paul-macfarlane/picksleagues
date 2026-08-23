import { asc, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, leagues, users } from "@picksleagues/db";
import {
  MEMBER_ROLE,
  type LeagueMember,
  type LeagueResponse,
  type LeagueSettings,
  type LeagueStatus,
  type PickemViewerStanding,
  type SurvivorViewerStanding,
} from "@picksleagues/schemas";
import { resolveUserImage } from "../users";

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
    image: resolveUserImage(row.user),
    role: row.member.role,
    joinedAt: row.member.createdAt.toISOString(),
  };
}

export function serializeLeague(
  league: LeagueRow,
  // status/seasonYear/settings come from the league's current instance
  // (ADR-0009); the wire shape stays flat, unchanged from the pre-split rows.
  status: LeagueStatus,
  seasonYear: number,
  settings: LeagueSettings,
  startsAt: Date | null,
  members: Array<{ member: typeof leagueMembers.$inferSelect; user: typeof users.$inferSelect }>,
  viewerId: string,
  // A newer season exists for the mode's sport than this instance is bound to
  // (ADR-0009) — the commissioner may renew. Derived by the callers where the
  // per-sport latest year is already at hand, never stored.
  renewable: boolean,
  // The viewer's own line, resolved by the caller per mode; null on the modes
  // that don't apply (which for March Madness is both, until epic 07).
  standing: {
    myPickemStanding: PickemViewerStanding | null;
    mySurvivorStanding: SurvivorViewerStanding | null;
  },
): LeagueResponse {
  // The viewer is always among `members` (getLeague joins on their own
  // membership; createLeague just inserted it) — the fallback is for types.
  const myRole = members.find((m) => m.user.id === viewerId)?.member.role ?? MEMBER_ROLE.MEMBER;
  return {
    id: league.id,
    name: league.name,
    mode: league.mode,
    visibility: league.visibility,
    status,
    seasonYear,
    settings,
    startsAt: startsAt ? startsAt.toISOString() : null,
    renewable,
    maxMembers: league.maxMembers,
    myRole,
    members: members.map(serializeMember),
    myPickemStanding: standing.myPickemStanding,
    mySurvivorStanding: standing.mySurvivorStanding,
  };
}
