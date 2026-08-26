import { cn } from "@/lib/utils";
import { rowClassName } from "@/components/row";
import { SPORT, type AdminTeam } from "@picksleagues/schemas";
import { useAdminTeams } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { Section } from "@/components/section";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";

/**
 * NCAAMB teams arrive with the March Madness epic; only NFL data exists
 * today (ADM-4 spec) — no sport picker until there's a second sport to pick.
 */
export function TeamsBrowser() {
  const teams = useAdminTeams(SPORT.NFL);

  return (
    <Section
      title="Teams"
      description={teams.data ? `${teams.data.teams.length} synced` : "Synced NFL teams"}
    >
      <QueryState
        isPending={teams.isPending}
        isError={teams.isError}
        onRetry={() => teams.refetch()}
        errorMessage="Couldn't load teams."
        pendingFallback={<RowsSkeleton label="Loading teams" rows={6} rowClassName="h-14 w-full" />}
        isEmpty={teams.data?.teams.length === 0}
        emptyMessage="No teams synced yet."
      >
        <ul className="flex flex-col">
          {teams.data?.teams.map((team) => (
            <TeamRow key={team.id} team={team} />
          ))}
        </ul>
      </QueryState>
    </Section>
  );
}

function TeamRow({ team }: { team: AdminTeam }) {
  return (
    <li className={cn(rowClassName, "flex items-center gap-3")}>
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
        <p className="text-xs text-muted-foreground">{team.location ?? "Location unknown"}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
        <p>{team.providerTeamId ?? "not provider-linked"}</p>
        <p className="type-eyebrow">Updated {formatDateTime(team.updatedAt)}</p>
      </div>
    </li>
  );
}
