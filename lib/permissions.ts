import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
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
