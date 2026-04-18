import { notFound } from "next/navigation";

import { DeleteLeagueButton } from "@/components/leagues/delete-league-button";
import { EditLeagueForm } from "@/components/leagues/edit-league-form";
import { Separator } from "@/components/ui/separator";
import { getLeagueById, getLeagueMemberCount } from "@/data/leagues";
import { getLeagueMember } from "@/data/members";
import { getPhasesBySeason } from "@/data/phases";
import { getSeasonsBySportsLeague } from "@/data/seasons";
import { getSession } from "@/lib/auth";
import {
  comparePhasesByOrdinal,
  hasLeagueStartLockPassed,
  leagueActivationTime,
  selectCurrentSeason,
} from "@/lib/nfl/leagues";
import { canLeagueRoleDo } from "@/lib/permissions";
import { getAppNow } from "@/lib/simulator";

export default async function LeagueSettingsPage(
  props: PageProps<"/leagues/[leagueId]/settings">,
) {
  const { leagueId } = await props.params;
  const session = await getSession();

  const league = await getLeagueById(leagueId);
  if (!league) {
    notFound();
  }

  const member = await getLeagueMember(leagueId, session.user.id);
  if (!member) {
    notFound();
  }

  // view_settings is true for every league role today; kept as a capability
  // so future read-only roles (e.g., observers) can opt out without touching
  // this page.
  const canEdit = canLeagueRoleDo(member.role, "edit_settings");
  const canDelete = canLeagueRoleDo(member.role, "delete_league");

  const now = await getAppNow();
  const [memberCount, seasons] = await Promise.all([
    getLeagueMemberCount(leagueId),
    getSeasonsBySportsLeague(league.sportsLeagueId),
  ]);
  const currentSeason = selectCurrentSeason(seasons, now);
  const phases = currentSeason ? await getPhasesBySeason(currentSeason.id) : [];
  const activation = currentSeason
    ? leagueActivationTime(league.createdAt, currentSeason.startDate)
    : league.createdAt;
  const structuralLocked = hasLeagueStartLockPassed(
    phases,
    league,
    activation,
    now,
  );

  const orderedPhases = [...phases].sort(comparePhasesByOrdinal);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? "Tweak the league's name, look, and scoring rules."
            : "Commissioners configure the league. You can see the current settings here."}
        </p>
      </header>
      <EditLeagueForm
        league={league}
        phases={orderedPhases}
        structuralLocked={structuralLocked}
        memberCount={memberCount}
        readOnly={!canEdit}
      />

      {canDelete ? (
        <>
          <Separator />

          <section className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold">Danger zone</h3>
              <p className="text-sm text-muted-foreground">
                Deleting the league removes it for every member. There&apos;s no
                recovery.
              </p>
            </div>
            <DeleteLeagueButton leagueId={league.id} leagueName={league.name} />
          </section>
        </>
      ) : null}
    </div>
  );
}
