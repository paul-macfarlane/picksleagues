import { createFileRoute } from "@tanstack/react-router";
import { LEAGUE_ACTION, MEMBER_ROLE } from "@picksleagues/schemas";
import { InvitePanel } from "@/components/league/invite-panel";
import { MembersSection } from "@/components/league/members-section";
import { useLeague } from "@/api/leagues";
import { useAppNow } from "@/lib/app-clock";
import { canActOnLeague, leagueHasStarted } from "@/lib/league";

export const Route = createFileRoute("/_authed/leagues/$leagueId/members")({
  component: LeagueMembers,
});

function LeagueMembers() {
  const { leagueId } = Route.useParams();
  // Populated by the parent layout route — this reads the same cache entry
  // (leagueQueryKey) and renders instantly rather than refetching.
  const league = useLeague(leagueId);
  const now = useAppNow();

  if (!league.data) return null;

  // Role axis alone (Decision 5): promote/demote are anytime actions and
  // must not vanish post-start just because they used to be wired through
  // the window-gated KICK_MEMBER.
  const isCommissioner = league.data.myRole === MEMBER_ROLE.COMMISSIONER;
  const started = leagueHasStarted(league.data, now);

  return (
    <div className="flex flex-col gap-4">
      <MembersSection league={league.data} isCommissioner={isCommissioner} started={started} />

      {canActOnLeague(league.data, LEAGUE_ACTION.MANAGE_INVITES, now) && (
        <InvitePanel leagueId={league.data.id} isCommissioner={isCommissioner} />
      )}
    </div>
  );
}
