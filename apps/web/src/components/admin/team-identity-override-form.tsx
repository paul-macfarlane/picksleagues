import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import type { AdminTeam } from "@picksleagues/schemas";
import { useSetTeamIdentityOverride } from "@/api/admin";
import {
  buildTeamIdentityOverridePatch,
  isTeamIdentityOverrideFormDirty,
  teamIdentityOverrideFormSeed,
  TEAM_IDENTITY_OVERRIDE_FIELDS,
  type TeamIdentityOverrideField,
} from "@/components/admin/team-identity-override-patch";
import { ProviderHint } from "@/components/admin/override-display";
import { FormTextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

const FIELD_LABEL: Record<TeamIdentityOverrideField, string> = {
  name: "Name",
  abbreviation: "Abbreviation",
  location: "Location",
  logoLightUrl: "Logo URL (light)",
  logoDarkUrl: "Logo URL (dark)",
};

const PROVIDER_VALUE: Record<TeamIdentityOverrideField, (team: AdminTeam) => string | null> = {
  name: (t) => t.name,
  abbreviation: (t) => t.abbreviation,
  location: (t) => t.location,
  logoLightUrl: (t) => t.logoLightUrl,
  logoDarkUrl: (t) => t.logoDarkUrl,
};

/**
 * Mounted fingerprint-keyed by the browser row (see `TeamsBrowser`), so the
 * seed is re-derived exactly when the stored override values change — the
 * same stale-baseline defense as `NflStatsOverrideForm`.
 */
export function TeamIdentityOverrideForm({ team }: { team: AdminTeam }) {
  const setOverride = useSetTeamIdentityOverride();
  const [seed] = useState(() => teamIdentityOverrideFormSeed(team));

  const form = useForm({
    defaultValues: seed,
    onSubmit: ({ value }) => {
      const result = buildTeamIdentityOverridePatch(seed, value);
      if (result.status === "unchanged") return;
      if (result.status === "invalid") {
        form.setErrorMap({ onSubmit: { fields: result.fieldErrors } });
        return;
      }
      setOverride.mutate({ teamId: team.id, override: result.patch });
    },
  });

  // Scoped to this row's own save (async-button standard) — every team in the
  // list mounts its own form.
  const pending = setOverride.isPending && setOverride.variables?.teamId === team.id;

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
        Every surface naming this team serves the corrected values.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TEAM_IDENTITY_OVERRIDE_FIELDS.map((fieldName) => (
          <ProviderHint key={fieldName} provider={PROVIDER_VALUE[fieldName](team) ?? "—"}>
            <form.Field name={fieldName}>
              {(field) => (
                <FormTextField
                  field={field}
                  id={`team-${team.id}-${fieldName}`}
                  label={FIELD_LABEL[fieldName]}
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
            disabled={pending || !isTeamIdentityOverrideFormDirty(seed, values)}
          >
            Save override
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
