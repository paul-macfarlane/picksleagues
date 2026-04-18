import { notFound } from "next/navigation";

import { DirectInvitesSection } from "@/components/invites/direct-invites-section";
import { LinkInvitesSection } from "@/components/invites/link-invites-section";
import { LeaveLeagueButton } from "@/components/leagues/leave-league-button";
import { MembersList } from "@/components/leagues/members-list";
import {
  getDirectInvitesByLeague,
  getLinkInvitesByLeague,
} from "@/data/invites";
import { getLeagueById } from "@/data/leagues";
import { getLeagueMember, getLeagueMembersWithProfiles } from "@/data/members";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { getSession } from "@/lib/auth";
import { isLeagueInSeason } from "@/lib/nfl/leagues";
import { canLeagueRoleDo } from "@/lib/permissions";

function inviteDisabledReason(
  atCapacity: boolean,
  inSeason: boolean,
): string | null {
  if (atCapacity)
    return "League is at capacity. Free up a spot to invite more members.";
  if (inSeason) return "Invites are paused while the league is in-season.";
  return null;
}

export default async function LeagueMembersPage(
  props: PageProps<"/leagues/[leagueId]/members">,
) {
  const { leagueId } = await props.params;
  const session = await getSession();

  const league = await getLeagueById(leagueId);
  if (!league) {
    notFound();
  }

  const [member, members, activePhases] = await Promise.all([
    getLeagueMember(leagueId, session.user.id),
    getLeagueMembersWithProfiles(leagueId),
    getActivePhasesForSportsLeague(league.sportsLeagueId, new Date()),
  ]);
  if (!member) {
    notFound();
  }

  const canInvite = canLeagueRoleDo(member.role, "invite_members");
  const canRevokeInvites = canLeagueRoleDo(member.role, "revoke_invites");
  const canLeave = canLeagueRoleDo(member.role, "leave_league");
  const viewerIsCommissioner = member.role === "commissioner";

  const inSeason = isLeagueInSeason(activePhases, league.seasonFormat);
  const atCapacity = members.length >= league.size;
  const disabledReason = inviteDisabledReason(atCapacity, inSeason);

  const [linkInvites, directInvites] = await Promise.all([
    canRevokeInvites ? getLinkInvitesByLeague(leagueId) : Promise.resolve([]),
    canRevokeInvites ? getDirectInvitesByLeague(leagueId) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-sm text-muted-foreground">
              {members.length} of {league.size}
              {viewerIsCommissioner && !inSeason
                ? " — you can promote, demote, or remove members."
                : viewerIsCommissioner
                  ? " — removals are paused while the league is in-season."
                  : ""}
            </p>
          </div>
        </div>
        <MembersList
          leagueId={leagueId}
          members={members}
          viewerUserId={session.user.id}
          viewerIsCommissioner={viewerIsCommissioner}
          canRemove={viewerIsCommissioner && !inSeason}
        />
      </section>

      {canInvite ? (
        <>
          <DirectInvitesSection
            leagueId={leagueId}
            existingInvites={directInvites}
            disabledReason={disabledReason}
          />

          <LinkInvitesSection
            leagueId={leagueId}
            existingInvites={linkInvites}
            disabledReason={disabledReason}
          />
        </>
      ) : null}

      {canLeave && !inSeason ? (
        <section className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Leave league</h2>
            <p className="text-sm text-muted-foreground">
              {members.length <= 1
                ? "You're the only member. Leaving deletes the league."
                : "Your standings for this league are cleared. You can rejoin later with a fresh slate."}
            </p>
          </div>
          <LeaveLeagueButton
            leagueId={leagueId}
            leagueName={league.name}
            isSoleMember={members.length <= 1}
          />
        </section>
      ) : null}
    </div>
  );
}
