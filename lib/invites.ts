import {
  removeDirectInvite,
  removeDirectInvitesByLeague,
  removeLinkInvitesByLeague,
} from "@/data/invites";
import { getLeagueById, getLeagueMemberCount } from "@/data/leagues";
import { getLeagueMember, insertLeagueMember } from "@/data/members";
import { getPhasesBySeason } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { insertLeagueStanding } from "@/data/standings";
import type { Transaction } from "@/data/utils";
import { withTransaction } from "@/data/utils";
import type { League, LeagueRole } from "@/lib/db/schema/leagues";
import {
  hasLeagueStartLockPassed,
  selectCurrentSeason,
} from "@/lib/nfl/leagues";
import { getAppNow } from "@/lib/simulator";

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

export type JoinLeagueResult =
  | { status: "joined" }
  | { status: "already_member" }
  | { status: "error"; error: string };

/**
 * Shared "accept an invite or use a link" flow. Inputs are typed DB rows +
 * derived values — callers (Server Actions in `actions/invites.ts`) zod-parse
 * their wire input first and fetch the League + invite rows from the data
 * layer before handing off. No zod here because the helper never sees raw
 * client input.
 *
 * The flow runs the §5.3 joining validation (not-already-member, not in-
 * season, not at capacity, current season resolvable), then inserts the
 * member + zeroed standing (and optionally deletes a consumed direct invite)
 * inside a single transaction, then runs the §5.4 capacity cleanup.
 */
export async function joinLeague(
  league: League,
  userId: string,
  role: LeagueRole,
  options: { directInviteIdToDelete?: string } = {},
): Promise<JoinLeagueResult> {
  const now = await getAppNow();
  const [memberCount, existingMember, seasons] = await Promise.all([
    getLeagueMemberCount(league.id),
    getLeagueMember(league.id, userId),
    getSeasonsBySportsLeague(league.sportsLeagueId),
  ]);

  if (existingMember) {
    return { status: "already_member" };
  }

  const currentSeason = selectCurrentSeason(seasons, now);
  if (!currentSeason) {
    return {
      status: "error",
      error: "No NFL season is synced yet. Try again later.",
    };
  }

  // §3.8 / §5.3: join is open until the league's start-week pick lock
  // fires. The commissioner picks the start week explicitly, so the start
  // lock is that week's pickLockTime — no activation-time inference.
  const phases = await getPhasesBySeason(currentSeason.id);
  if (hasLeagueStartLockPassed(phases, league, now)) {
    return {
      status: "error",
      error: "The league's start lock has passed — you can't join this season.",
    };
  }

  if (memberCount >= league.size) {
    return { status: "error", error: "This league is already at capacity." };
  }

  await withTransaction(async (tx) => {
    await insertLeagueMember({ leagueId: league.id, userId, role }, tx);
    await insertLeagueStanding(
      { leagueId: league.id, userId, seasonId: currentSeason.id },
      tx,
    );
    if (options.directInviteIdToDelete) {
      await removeDirectInvite(options.directInviteIdToDelete, tx);
    }
  });

  await cleanupInvitesIfFull(league.id);
  return { status: "joined" };
}
