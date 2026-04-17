import { getLeagueMember } from "@/data/members";
import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
import type { LeagueMember } from "@/lib/db/schema/leagues";
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
