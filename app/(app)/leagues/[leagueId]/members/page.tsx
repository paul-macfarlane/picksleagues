import { notFound } from "next/navigation";

import { CreateDirectInviteDialog } from "@/components/invites/create-direct-invite-dialog";
import { ComingSoon } from "@/components/leagues/coming-soon";
import { getLeagueById } from "@/data/leagues";
import { getLeagueMember } from "@/data/members";
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

  const [member, activePhases] = await Promise.all([
    getLeagueMember(leagueId, session.user.id),
    getActivePhasesForSportsLeague(league.sportsLeagueId, new Date()),
  ]);

  const isCommissioner = member?.role === "commissioner";
  const inSeason = isLeagueInSeason(activePhases, league.seasonFormat);

  return (
    <div className="flex flex-col gap-6">
      {isCommissioner ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Invite members</h2>
              <p className="text-sm text-muted-foreground">
                Send a direct invite to a specific user.
              </p>
            </div>
            {inSeason ? null : <CreateDirectInviteDialog leagueId={leagueId} />}
          </div>
          {inSeason ? (
            <p className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
              Invites are paused while the league is in-season.
            </p>
          ) : null}
        </section>
      ) : null}

      <ComingSoon
        title="Members"
        description="The member list and role management land in PL-025."
      />
    </div>
  );
}
