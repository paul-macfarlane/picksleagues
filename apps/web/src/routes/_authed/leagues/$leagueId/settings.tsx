import { createFileRoute } from "@tanstack/react-router";
import { MEMBER_ROLE } from "@picksleagues/schemas";
import { DangerZoneSection } from "@/components/league/danger-zone";
import { LeagueSettingsSection } from "@/components/league/settings-section";
import { useLeague } from "@/api/leagues";
import { useAppNow } from "@/lib/app-clock";
import { leagueHasStarted } from "@/lib/league";

export const Route = createFileRoute("/_authed/leagues/$leagueId/settings")({
  component: LeagueSettings,
});

function LeagueSettings() {
  const { leagueId } = Route.useParams();
  // Populated by the parent layout route — this reads the same cache entry
  // (leagueQueryKey) and renders instantly rather than refetching.
  const league = useLeague(leagueId);
  const now = useAppNow();

  if (!league.data) return null;

  // Danger Zone renders on the role axis alone (Decision 4): a commissioner
  // whose window closed still sees it, with Delete disabled + a reason —
  // rendering nothing here would erase the explanation that's the ticket's
  // point.
  const isCommissioner = league.data.myRole === MEMBER_ROLE.COMMISSIONER;
  const started = leagueHasStarted(league.data, now);

  return (
    <div className="flex flex-col gap-4">
      {/* Settings are visible (read-only) to every member — canEdit gates
          only whether inputs are editable and whether Save renders. */}
      <LeagueSettingsSection league={league.data} canEdit={isCommissioner} started={started} />

      {isCommissioner && <DangerZoneSection league={league.data} started={started} />}
    </div>
  );
}
