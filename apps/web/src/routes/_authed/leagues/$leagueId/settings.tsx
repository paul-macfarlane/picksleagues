import { createFileRoute } from "@tanstack/react-router";
import { LEAGUE_ACTION } from "@picksleagues/schemas";
import { DangerZoneSection } from "@/components/league/danger-zone";
import { LeagueSettingsSection } from "@/components/league/settings-section";
import { useLeague } from "@/api/leagues";
import { canActOnLeague } from "@/lib/league";

export const Route = createFileRoute("/_authed/leagues/$leagueId/settings")({
  component: LeagueSettings,
});

function LeagueSettings() {
  const { leagueId } = Route.useParams();
  // Populated by the parent layout route — this reads the same cache entry
  // (leagueQueryKey) and renders instantly rather than refetching.
  const league = useLeague(leagueId);

  if (!league.data) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Settings are visible (read-only) to every member — canEdit gates
          only whether inputs are editable and whether Save renders. */}
      <LeagueSettingsSection
        league={league.data}
        canEdit={canActOnLeague(league.data, LEAGUE_ACTION.EDIT_SETTINGS)}
      />

      {canActOnLeague(league.data, LEAGUE_ACTION.DELETE_LEAGUE) && (
        <DangerZoneSection league={league.data} />
      )}
    </div>
  );
}
