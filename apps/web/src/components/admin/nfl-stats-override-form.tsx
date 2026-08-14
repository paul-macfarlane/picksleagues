import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import type { AdminNflTeamSeasonStats } from "@picksleagues/schemas";
import { useSetNflStatsOverride } from "@/api/admin-nfl-stats";
import {
  buildNflStatsOverridePatch,
  isNflStatsOverrideFormDirty,
  nflStatsOverrideFormSeed,
  NFL_STATS_OVERRIDE_FIELDS,
  type NflStatsOverrideField,
} from "@/components/admin/nfl-stats-override-patch";
import { ProviderHint } from "@/components/admin/override-display";
import { FormTextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

const FIELD_LABEL: Record<NflStatsOverrideField, string> = {
  wins: "Wins",
  losses: "Losses",
  ties: "Ties",
  homeWins: "Home wins",
  homeLosses: "Home losses",
  homeTies: "Home ties",
  roadWins: "Road wins",
  roadLosses: "Road losses",
  roadTies: "Road ties",
  streak: "Streak (signed)",
  pointsFor: "Points for",
  pointsAgainst: "Points against",
};

const PROVIDER_VALUE: Record<NflStatsOverrideField, (stats: AdminNflTeamSeasonStats) => number> = {
  wins: (s) => s.wins,
  losses: (s) => s.losses,
  ties: (s) => s.ties,
  homeWins: (s) => s.homeWins,
  homeLosses: (s) => s.homeLosses,
  homeTies: (s) => s.homeTies,
  roadWins: (s) => s.roadWins,
  roadLosses: (s) => s.roadLosses,
  roadTies: (s) => s.roadTies,
  streak: (s) => s.streak,
  pointsFor: (s) => s.pointsFor,
  pointsAgainst: (s) => s.pointsAgainst,
};

/**
 * Mounted fingerprint-keyed by the browser row (see `NflStatsBrowser`), so the
 * seed is re-derived exactly when the stored override values change — the
 * same stale-baseline defense as `GameOverrideForm`.
 */
export function NflStatsOverrideForm({ stats }: { stats: AdminNflTeamSeasonStats }) {
  const setOverride = useSetNflStatsOverride();
  const [seed] = useState(() => nflStatsOverrideFormSeed(stats));

  const form = useForm({
    defaultValues: seed,
    onSubmit: ({ value }) => {
      const result = buildNflStatsOverridePatch(seed, value);
      if (result.status === "unchanged") return;
      if (result.status === "invalid") {
        form.setErrorMap({ onSubmit: { fields: result.fieldErrors } });
        return;
      }
      setOverride.mutate({
        statsId: stats.id,
        teamAbbreviation: stats.team.abbreviation,
        override: result.patch,
      });
    },
  });

  // Scoped to this row's own save (async-button standard) — every row in the
  // season mounts its own form.
  const pending = setOverride.isPending && setOverride.variables?.statsId === stats.id;

  return (
    <form
      className="mt-2 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Fire-and-forget: the mutation's toast/invalidation owns the outcome.
        void form.handleSubmit();
      }}
      noValidate
    >
      <p className="text-xs text-muted-foreground">
        Each field overrides the provider independently. Clear one to hand it back to the provider.
        Averages and ranks on the member surface follow the corrected values.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {NFL_STATS_OVERRIDE_FIELDS.map((fieldName) => (
          <ProviderHint key={fieldName} provider={String(PROVIDER_VALUE[fieldName](stats))}>
            <form.Field name={fieldName}>
              {(field) => (
                <FormTextField
                  field={field}
                  id={`stats-${stats.id}-${fieldName}`}
                  label={FIELD_LABEL[fieldName]}
                  inputMode="numeric"
                />
              )}
            </form.Field>
          </ProviderHint>
        ))}
      </div>

      {/* Gated on a real change, the sibling forms' idiom — an untouched save
          is a no-op round trip that writes an audit row for nothing. */}
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={pending || !isNflStatsOverrideFormDirty(seed, values)}
          >
            Save override
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
