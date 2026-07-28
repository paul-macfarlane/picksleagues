import { SPORT } from "@picksleagues/schemas";
import { useAdminTeams } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";

// NCAAMB teams arrive with the March Madness epic; only NFL data exists
// today (ADM-4 spec) — no sport picker until there's a second sport to pick.
export function TeamsBrowser() {
  const teams = useAdminTeams(SPORT.NFL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Teams</CardTitle>
        <CardDescription>
          {teams.data ? `${teams.data.teams.length} synced` : "Synced NFL teams"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          isPending={teams.isPending}
          isError={teams.isError}
          onRetry={() => teams.refetch()}
          errorMessage="Couldn't load teams."
          isEmpty={teams.data?.teams.length === 0}
          emptyMessage="No teams synced yet."
        >
          <ul className="flex flex-col gap-2">
            {teams.data?.teams.map((team) => (
              <li
                key={team.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <TeamLogo
                  logoLightUrl={team.logoLightUrl}
                  logoDarkUrl={team.logoDarkUrl}
                  size="lg"
                  placeholder
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="text-sm font-medium text-foreground">
                    {team.abbreviation} — {team.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {team.location ?? "Location unknown"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end text-xs text-muted-foreground">
                  <p>{team.providerTeamId ?? "not provider-linked"}</p>
                  <p>Updated {formatDateTime(team.updatedAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </QueryState>
      </CardContent>
    </Card>
  );
}
