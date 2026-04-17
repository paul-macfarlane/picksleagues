import { notFound } from "next/navigation";

import { DeleteLeagueButton } from "@/components/leagues/delete-league-button";
import { EditLeagueForm } from "@/components/leagues/edit-league-form";
import { Separator } from "@/components/ui/separator";
import { getLeagueById, getLeagueMemberCount } from "@/data/leagues";
import { getActivePhasesForSportsLeague } from "@/data/phases";
import { getSession } from "@/lib/auth";
import { isLeagueInSeason } from "@/lib/nfl/leagues";
import { assertLeagueCommissioner } from "@/lib/permissions";

export default async function LeagueSettingsPage(
  props: PageProps<"/leagues/[leagueId]/settings">,
) {
  const { leagueId } = await props.params;
  const session = await getSession();
  await assertLeagueCommissioner(session.user.id, leagueId);

  const league = await getLeagueById(leagueId);
  if (!league) {
    notFound();
  }

  const [activePhases, memberCount] = await Promise.all([
    getActivePhasesForSportsLeague(league.sportsLeagueId, new Date()),
    getLeagueMemberCount(leagueId),
  ]);
  const inSeason = isLeagueInSeason(activePhases, league.seasonFormat);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Tweak the league&apos;s name, look, and scoring rules.
        </p>
      </header>
      <EditLeagueForm
        league={league}
        inSeason={inSeason}
        memberCount={memberCount}
      />

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
    </div>
  );
}
