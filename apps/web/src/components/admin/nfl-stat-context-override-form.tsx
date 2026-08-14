import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import type {
  AdminNflGameStatContext,
  AdminNflGameStatContextBlock,
  NflGameStatContextOverrideRequest,
  NflGameStatsTeamContext,
} from "@picksleagues/schemas";
import { useSetNflStatContextOverride } from "@/api/admin-nfl-stats";
import {
  buildNflContextOverrideRequest,
  isNflContextOverrideFormDirty,
  nflContextOverrideFormSeed,
  type NflContextOverrideFormValues,
} from "@/components/admin/nfl-context-override-patch";
import { FormTextareaField, FormTextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

const INJURIES_PLACEHOLDER =
  '[{"athleteName":"A. Player","position":"WR","status":"Out","injuryType":"Ankle"}]';
const LAST_FIVE_PLACEHOLDER =
  '[{"result":"W","opponentAbbr":"KC","teamScore":24,"opponentScore":17,"atHome":true}]';

/**
 * One team's four override fields. The list fields edit as JSON (owner,
 * 2026-08-13 — validated through the shared Zod schemas at save, so bad text
 * never reaches the wire); their hints carry the provider value compactly,
 * since a full JSON dump of an injury report is not a "provider:" suffix.
 */
function SideFields({
  gameId,
  side,
  label,
  provider,
  form,
}: {
  gameId: string;
  side: "home" | "away";
  label: string;
  provider: NflGameStatsTeamContext;
  form: ReturnType<typeof useContextForm>;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="text-xs font-semibold text-foreground">{label}</legend>
      <form.Field name={`${side}:injuries`}>
        {(field) => (
          <FormTextareaField
            field={field}
            id={`context-${gameId}-${side}-injuries`}
            label="Injuries override (JSON)"
            hint={`Provider: ${provider.injuries.length} entries. Leave blank for no override; [] masks the provider's report.`}
            placeholder={INJURIES_PLACEHOLDER}
            rows={4}
          />
        )}
      </form.Field>
      <form.Field name={`${side}:fpiWinPct`}>
        {(field) => (
          <FormTextField
            field={field}
            id={`context-${gameId}-${side}-fpiWinPct`}
            label="FPI win % override"
            hint={`Provider: ${provider.fpiWinPct === null ? "none" : `${provider.fpiWinPct}%`}`}
            inputMode="decimal"
          />
        )}
      </form.Field>
      <form.Field name={`${side}:atsSummary`}>
        {(field) => (
          <FormTextField
            field={field}
            id={`context-${gameId}-${side}-atsSummary`}
            label="ATS summary override"
            hint={`Provider: ${provider.atsSummary ?? "none"}`}
          />
        )}
      </form.Field>
      <form.Field name={`${side}:lastFive`}>
        {(field) => (
          <FormTextareaField
            field={field}
            id={`context-${gameId}-${side}-lastFive`}
            label="Last five override (JSON)"
            hint={`Provider: ${provider.lastFive.length} entries.`}
            placeholder={LAST_FIVE_PLACEHOLDER}
            rows={4}
          />
        )}
      </form.Field>
    </fieldset>
  );
}

// A real hook, not a type crutch: the component builds its form through this
// so `SideFields` can name the form's concrete type without restating the
// generics TanStack infers from the values shape. Validation runs here (via
// `formApi`, not a closed-over `form` — the instance doesn't exist yet while
// this callback is being wired) and only a wire-valid request escapes.
function useContextForm(
  seed: NflContextOverrideFormValues,
  onValid: (request: NflGameStatContextOverrideRequest) => void,
) {
  return useForm({
    defaultValues: seed,
    onSubmit: ({ value, formApi }) => {
      const result = buildNflContextOverrideRequest(value);
      if (result.status === "invalid") {
        formApi.setErrorMap({ onSubmit: { fields: result.fieldErrors } });
        return;
      }
      onValid(result.request);
    },
  });
}

/**
 * Mounted fingerprint-keyed by the browser row, the sibling forms' contract.
 * Saving replaces the whole override layer (PUT semantics): the form's current
 * values *are* the correction, so clearing every field and saving clears the
 * layer — arch D15's clean revert.
 */
export function NflStatContextOverrideForm({
  game,
  block,
}: {
  game: AdminNflGameStatContext;
  block: AdminNflGameStatContextBlock;
}) {
  const setOverride = useSetNflStatContextOverride();
  const [seed] = useState(() => nflContextOverrideFormSeed(block));

  const form = useContextForm(seed, (request) =>
    setOverride.mutate({ gameId: game.gameId, override: request }),
  );

  const pending = setOverride.isPending && setOverride.variables?.gameId === game.gameId;

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
        A filled field overrides the provider's whole value for that field; a blank one keeps
        tracking the provider. Saving replaces the entire override layer with what's below.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SideFields
          gameId={game.gameId}
          side="away"
          label={`${game.awayTeam.abbreviation} (away)`}
          provider={block.payload.away}
          form={form}
        />
        <SideFields
          gameId={game.gameId}
          side="home"
          label={`${game.homeTeam.abbreviation} (home)`}
          provider={block.payload.home}
          form={form}
        />
      </div>

      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={pending || !isNflContextOverrideFormDirty(seed, values)}
          >
            Save override
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
