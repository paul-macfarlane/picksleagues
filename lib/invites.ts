import {
  removeDirectInvitesByLeague,
  removeLinkInvitesByLeague,
} from "@/data/invites";
import { getLeagueById, getLeagueMemberCount } from "@/data/leagues";
import type { Transaction } from "@/data/utils";

/**
 * BUSINESS_SPEC §5.4: when a league reaches its maximum size, all remaining
 * pending invites for that league are automatically deleted. Invoked after a
 * join that could push the league to capacity, and after a settings update
 * that shrinks the league size down to its current member count.
 *
 * Lives in `lib/` (not `data/`) because it encodes a business invariant —
 * the capacity policy — and crosses data modules. Consistent with
 * `lib/permissions.ts` and `lib/sync/` being allowed to call `data/`.
 */
export async function cleanupInvitesIfFull(
  leagueId: string,
  tx?: Transaction,
): Promise<void> {
  const league = await getLeagueById(leagueId, tx);
  if (!league) return;
  const count = await getLeagueMemberCount(leagueId, tx);
  if (count >= league.size) {
    await Promise.all([
      removeDirectInvitesByLeague(leagueId, tx),
      removeLinkInvitesByLeague(leagueId, tx),
    ]);
  }
}
