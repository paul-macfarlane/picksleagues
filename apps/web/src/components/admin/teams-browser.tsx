import { cn } from "@/lib/utils";
import { rowClassName } from "@/components/row";
import { SPORT, type AdminTeam } from "@picksleagues/schemas";
import { useAdminTeams } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { OverriddenTag, ResolvedField } from "@/components/admin/override-display";
import { TeamIdentityOverrideForm } from "@/components/admin/team-identity-override-form";
import { teamIdentityOverrideFormSeed } from "@/components/admin/team-identity-override-patch";
import { Section } from "@/components/section";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { RowEditor } from "@/components/row-editor";
import { TeamLogo } from "@/components/team-logo";

/**
 * NCAAMB teams arrive with the March Madness epic; only NFL data exists
 * today (ADM-4 spec) — no sport picker until there's a second sport to pick.
 * Since STAT-8 (ADR-0042) the rows also carry the identity override editor:
 * effective values lead, with the provider's beside any overridden field.
 */
export function TeamsBrowser() {
  const teams = useAdminTeams(SPORT.NFL);

  return (
    <Section
      title="Teams"
      description={
        <>
          {teams.data ? `${teams.data.teams.length} synced` : "Synced NFL teams"} · display fields
          are correctable; identity keys are not
        </>
      }
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
    <li className={cn(rowClassName, "flex flex-col gap-2")}>
      <div className="flex items-center gap-3">
        <TeamLogo
          logoLightUrl={team.effectiveLogoLightUrl}
          logoDarkUrl={team.effectiveLogoDarkUrl}
          size="lg"
          placeholder
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-sm font-medium text-foreground">
            {team.effectiveAbbreviation} — {team.effectiveName}
          </p>
          <p className="text-xs text-muted-foreground">
            {team.effectiveLocation ?? "Location unknown"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
          {/* `overriddenAt` is set exactly while any override field is
              (cleared with the last one, arch D15), so it stands in for
              checking all five. */}
          {team.overriddenAt !== null && <OverriddenTag />}
          <p>{team.providerTeamId ?? "not provider-linked"}</p>
          <p>Updated {formatDateTime(team.updatedAt)}</p>
        </div>
      </div>

      {team.overriddenAt !== null && (
        <div className="flex flex-col gap-1 text-xs text-foreground">
          <ResolvedField
            label="Name"
            resolved={team.effectiveName}
            provider={team.name}
            showProvider={team.overrideName !== null}
          />
          <ResolvedField
            label="Abbreviation"
            resolved={team.effectiveAbbreviation}
            provider={team.abbreviation}
            showProvider={team.overrideAbbreviation !== null}
          />
          <ResolvedField
            label="Location"
            resolved={team.effectiveLocation ?? "—"}
            provider={team.location ?? "—"}
            showProvider={team.overrideLocation !== null}
          />
          <ResolvedField
            label="Logo (light)"
            resolved={team.effectiveLogoLightUrl ?? "—"}
            provider={team.logoLightUrl ?? "—"}
            showProvider={team.overrideLogoLightUrl !== null}
          />
          <ResolvedField
            label="Logo (dark)"
            resolved={team.effectiveLogoDarkUrl ?? "—"}
            provider={team.logoDarkUrl ?? "—"}
            showProvider={team.overrideLogoDarkUrl !== null}
          />
        </div>
      )}

      <RowEditor label="Edit override">
        <TeamIdentityOverrideForm
          key={JSON.stringify(teamIdentityOverrideFormSeed(team))}
          team={team}
        />
      </RowEditor>
    </li>
  );
}
