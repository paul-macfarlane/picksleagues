import { ForbiddenError } from "@/lib/errors";
import type { Profile } from "@/lib/db/schema/profiles";

export function assertAdmin(profile: Profile): void {
  if (profile.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
}
