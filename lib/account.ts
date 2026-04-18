import { deleteAccountsByUserId, deleteSessionsByUserId } from "@/data/auth";
import { removeLeague } from "@/data/leagues";
import type { LeagueMembershipSummary } from "@/data/members";
import { removeLeagueMember } from "@/data/members";
import { updateProfileByUserId } from "@/data/profiles";
import { updateUserById } from "@/data/users";
import type { Transaction } from "@/data/utils";

const USERNAME_MAX_LENGTH = 50;
const ANONYMOUS_DISPLAY_NAME = "Anonymous User";

/**
 * BUSINESS_SPEC §2.3 step 1: account deletion is blocked when the user is
 * the sole commissioner of any multi-member league. Returns every league
 * that stops the deletion — the empty array means the flow can proceed.
 */
export function getSoleCommissionerBlockers(
  summary: LeagueMembershipSummary[],
): LeagueMembershipSummary[] {
  return summary.filter(
    (row) =>
      row.role === "commissioner" &&
      row.memberCount > 1 &&
      row.commissionerCount === 1,
  );
}

export async function anonymizeUser(
  userId: string,
  summary: LeagueMembershipSummary[],
  tx?: Transaction,
): Promise<void> {
  const anonymousEmail = `anonymous+${userId}@deleted.picksleagues.local`;
  const anonymousUsername = `anonymous-${userId}`.slice(0, USERNAME_MAX_LENGTH);

  // §2.3 steps 2 + 3: prune league involvement before scrubbing identity.
  // Sole-member leagues are deleted (cascade removes members/standings/invites).
  // Multi-member leagues keep their history; this user's membership row goes.
  // Standings stay put because they key off user.id, which persists as an
  // anonymized tombstone — per §2.3 step 6.
  for (const row of summary) {
    if (row.memberCount <= 1) {
      await removeLeague(row.leagueId, tx);
    } else {
      await removeLeagueMember(row.leagueId, userId, tx);
    }
  }

  await deleteSessionsByUserId(userId, tx);
  await deleteAccountsByUserId(userId, tx);
  await updateUserById(
    userId,
    {
      name: ANONYMOUS_DISPLAY_NAME,
      email: anonymousEmail,
      image: null,
    },
    tx,
  );
  await updateProfileByUserId(
    userId,
    {
      username: anonymousUsername,
      name: ANONYMOUS_DISPLAY_NAME,
      avatarUrl: null,
    },
    tx,
  );
}
