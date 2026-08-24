import { createFileRoute } from "@tanstack/react-router";
import { MEMBER_ROLE } from "@picksleagues/schemas";
import { DangerZoneSection } from "@/components/league/danger-zone";
import { DuesSection } from "@/components/league/dues-section";
import { LeagueSettingsSection } from "@/components/league/settings-section";
import { LeagueSettingsSummary } from "@/components/league/settings-summary";
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

  const isCommissioner = league.data.myRole === MEMBER_ROLE.COMMISSIONER;

  // The role axis splits the whole tab, not just the Save button: a member
  // gets the settings stated as values (settings-summary.tsx says why a
  // disabled form isn't that), and the commissioner-only sections below fall
  // away with the form instead of being gated one by one. Dues and Leave
  // league already reach members on the Members tab.
  if (!isCommissioner) {
    return <LeagueSettingsSummary league={league.data} />;
  }

  const started = leagueHasStarted(league.data, now);

  return (
    <div className="flex flex-col gap-4">
      <LeagueSettingsSection league={league.data} started={started} />

      {/* Dues are commissioner-set with no start window (ADR-0045), so the
          section takes no `started`. */}
      <DuesSection league={league.data} />

      {/* Danger Zone survives the window closing: a commissioner whose window
          closed still sees it, with Delete disabled + a reason — rendering
          nothing would erase the explanation that's the section's point. */}
      <DangerZoneSection league={league.data} started={started} />
    </div>
  );
}
