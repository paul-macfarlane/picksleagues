import { createFileRoute } from "@tanstack/react-router";
import { LEAGUE_ACTION, MEMBER_ROLE } from "@picksleagues/schemas";
import { InvitePanel } from "@/components/league/invite-panel";
import { MembersSection } from "@/components/league/members-section";
import { canActOnLeague, useLeague } from "@/components/league/use-league";

export const Route = createFileRoute("/_authed/leagues/$leagueId/members")({
  component: LeagueMembers,
});

function LeagueMembers() {
  const { leagueId } = Route.useParams();
  // Populated by the parent layout route — this reads the same cache entry
  // (leagueQueryKey) and renders instantly rather than refetching.
  const league = useLeague(leagueId);

  if (!league.data) return null;

  const isCommissioner = league.data.myRole === MEMBER_ROLE.COMMISSIONER;

  return (
    <div className="flex flex-col gap-4">
      <MembersSection
        league={league.data}
        isCommissioner={canActOnLeague(league.data, LEAGUE_ACTION.KICK_MEMBER)}
      />

      {canActOnLeague(league.data, LEAGUE_ACTION.MANAGE_INVITES) && (
        <InvitePanel leagueId={league.data.id} isCommissioner={isCommissioner} />
      )}
    </div>
  );
}
