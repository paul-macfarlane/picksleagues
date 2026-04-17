import { notFound } from "next/navigation";

import { CreateDirectInviteDialog } from "@/components/invites/create-direct-invite-dialog";
import { LinkInvitesSection } from "@/components/invites/link-invites-section";
import { LeaveLeagueButton } from "@/components/leagues/leave-league-button";
import { MembersList } from "@/components/leagues/members-list";
import { getLinkInvitesByLeague } from "@/data/invites";
import { getLeagueById } from "@/data/leagues";
import { getLeagueMember, getLeagueMembersWithProfiles } from "@/data/members";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { getSession } from "@/lib/auth";
import { isLeagueInSeason } from "@/lib/nfl/leagues";

export default async function LeagueMembersPage(
  props: PageProps<"/leagues/[leagueId]/members">,
) {
  const { leagueId } = await props.params;
  const session = await getSession();

  const league = await getLeagueById(leagueId);
  if (!league) {
    notFound();
  }

  const [viewerMember, members, activePhases] = await Promise.all([
    getLeagueMember(leagueId, session.user.id),
    getLeagueMembersWithProfiles(leagueId),
    getActivePhasesForSportsLeague(league.sportsLeagueId, new Date()),
  ]);

  const viewerIsCommissioner = viewerMember?.role === "commissioner";
  const inSeason = isLeagueInSeason(activePhases, league.seasonFormat);
  const linkInvites = viewerIsCommissioner
    ? await getLinkInvitesByLeague(leagueId)
    : [];

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

      {viewerIsCommissioner ? (
        <>
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Invite members</h2>
                <p className="text-sm text-muted-foreground">
                  Send a direct invite to a specific user.
                </p>
              </div>
              {inSeason ? null : (
                <CreateDirectInviteDialog leagueId={leagueId} />
              )}
            </div>
            {inSeason ? (
              <p className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
                Direct invites are paused while the league is in-season.
              </p>
            ) : null}
          </section>

          <LinkInvitesSection
            leagueId={leagueId}
            existingInvites={linkInvites}
            disabled={inSeason}
          />
        </>
      ) : null}

      {viewerMember && !inSeason ? (
        <section className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Leave league</h2>
            <p className="text-sm text-muted-foreground">
              {members.length <= 1
                ? "You're the only member. Leaving deletes the league."
                : "Historical picks and standings stay — you just stop participating."}
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
