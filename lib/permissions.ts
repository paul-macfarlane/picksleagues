import { getLeagueMember } from "@/data/members";
import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
import type { LeagueMember, LeagueRole } from "@/lib/db/schema/leagues";
import type { Profile } from "@/lib/db/schema/profiles";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

export function assertAdmin(profile: Profile): void {
  if (profile.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
}

export async function requireAdminSession(): Promise<{
  userId: string;
  profile: Profile;
}> {
  const session = await getSession();
  const profile = await getProfileByUserId(session.user.id);
  if (!profile) {
    throw new NotFoundError("Profile not found");
  }
  assertAdmin(profile);
  return { userId: session.user.id, profile };
}

export async function assertLeagueMember(
  userId: string,
  leagueId: string,
): Promise<LeagueMember> {
  const member = await getLeagueMember(leagueId, userId);
  if (!member) {
    throw new ForbiddenError("Not a league member");
  }
  return member;
}

export async function assertLeagueCommissioner(
  userId: string,
  leagueId: string,
): Promise<LeagueMember> {
  const member = await assertLeagueMember(userId, leagueId);
  if (member.role !== "commissioner") {
    throw new ForbiddenError("Must be a league commissioner");
  }
  return member;
}

export const LEAGUE_CAPABILITIES = [
  "view_settings",
  "edit_settings",
  "delete_league",
  "invite_members",
  "revoke_invites",
  "leave_league",
] as const;

export type LeagueCapability = (typeof LEAGUE_CAPABILITIES)[number];

const CAPABILITIES_BY_ROLE: Record<
  LeagueRole,
  ReadonlySet<LeagueCapability>
> = {
  commissioner: new Set<LeagueCapability>([
    "view_settings",
    "edit_settings",
    "delete_league",
    "invite_members",
    "revoke_invites",
    "leave_league",
  ]),
  member: new Set<LeagueCapability>(["view_settings", "leave_league"]),
};

export function canLeagueRoleDo(
  role: LeagueRole,
  capability: LeagueCapability,
): boolean {
  return CAPABILITIES_BY_ROLE[role].has(capability);
}
