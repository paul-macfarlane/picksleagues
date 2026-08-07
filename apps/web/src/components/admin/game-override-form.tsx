import type { ReactNode } from "react";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { GAME_STATUS, type AdminGame } from "@picksleagues/schemas";
import { useSetGameOverride } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { clockLabel, gameStatusLabel, periodLabel } from "@/lib/game";
import {
  buildGameOverridePatch,
  gameOverrideFormSeed,
  isGameOverrideFormDirty,
  NO_STATUS_OVERRIDE,
  type GameOverrideStatusValue,
} from "@/components/admin/game-override-patch";
import { FormDateTimeField } from "@/components/form-date-time-field";
import { FormTextField } from "@/components/form-field";
import { LabeledSelect } from "@/components/labeled-select";
import { Button } from "@/components/ui/button";

// Derived from the const object (never a restated literal list) so the dropdown
// can't drift from `GameStatusSchema`. The leading entry is the clear option —
// an override is optional per field, and this is how a field gets given back to
// the provider (arch D15).
const STATUS_OPTIONS: { value: GameOverrideStatusValue; label: string }[] = [
  { value: NO_STATUS_OVERRIDE, label: "No override — use provider" },
  ...Object.values(GAME_STATUS).map((status) => ({
    value: status,
    label: gameStatusLabel(status),
  })),
];

function scoreHint(score: number | null): string {
  return score === null ? "no score" : String(score);
}

function periodHint(period: number | null): string {
  return period === null ? "no period" : periodLabel(period);
}

function clockHint(clockSeconds: number | null): string {
  return clockSeconds === null ? "no clock" : clockLabel(clockSeconds);
}

/**
 * Pairs a field with the provider value it sits on top of, because the two
 * questions an operator asks here are "what am I overriding?" and "what would
 * clearing this restore?" — and the answer to both is the provider column,
 * which the resolved display above the form deliberately hides.
 */
function ProviderHint({ children, provider }: { children: ReactNode; provider: string }) {
  return (
    <div className="flex flex-col gap-1">
      {children}
      <p className="text-xs text-muted-foreground">Provider: {provider}</p>
    </div>
  );
}

export function GameOverrideForm({ game }: { game: AdminGame }) {
  // Remounts (and re-seeds) whenever the override values this form diffs
  // against actually change server-side — same idiom as league settings'
  // `settingsFingerprint` (settings-section.tsx). A save here invalidates the
  // whole query cache (api/admin.ts), which refetches `game` with the just-saved
  // values; without this key the inner form's `seed` state and TanStack Form's
  // `defaultValues` would stay pinned to what the operator saw at first mount,
  // so a second save in the same still-open editor would diff against a stale
  // baseline and could silently omit a field the operator just cleared (that
  // field's prior override would then never be un-set). Fingerprinting on the
  // seed shape (not the whole `game`) means an unrelated refetch — one that
  // doesn't change any override field — never resets the operator's in-progress
  // edits.
  return <GameOverrideEditor key={JSON.stringify(gameOverrideFormSeed(game))} game={game} />;
}

function GameOverrideEditor({ game }: { game: AdminGame }) {
  const setOverride = useSetGameOverride();
  // Seeded once per mount, which — thanks to the fingerprint key above — is
  // exactly once per distinct server-side override value. Still deliberately
  // not re-derived on every render: within one mount, this is both what the
  // operator was shown and the baseline every save diffs against.
  const [seed] = useState(() => gameOverrideFormSeed(game));

  const form = useForm({
    defaultValues: seed,
    onSubmit: ({ value }) => {
      const result = buildGameOverridePatch(seed, value);
      if (result.status === "unchanged") return;
      if (result.status === "invalid") {
        // Field errors, not a toast: these are per-input problems the operator
        // fixes in place. The server's 409 stays reserved for the cross-field
        // refusal (a kickoff that would re-open a started game).
        form.setErrorMap({ onSubmit: { fields: result.fieldErrors } });
        return;
      }
      setOverride.mutate({ gameId: game.id, override: result.patch });
    },
  });

  // Scoped to this row's own in-flight save (async-button standard): every game
  // in the week mounts its own form, and a list-wide flag would disable them all.
  const pending = setOverride.isPending && setOverride.variables?.gameId === game.id;

  return (
    <form
      className="mt-2 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Fire-and-forget: form-core re-throws an awaited rejection out of
        // handleSubmit as an unhandled rejection; the mutation's own
        // toast/invalidation (api/admin.ts) owns success and failure.
        void form.handleSubmit();
      }}
      noValidate
    >
      <p className="text-xs text-muted-foreground">
        Each field overrides the provider independently. Clear one to hand it back to the provider.
        Saving re-settles every league holding a pick on this game.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ProviderHint provider={formatDateTime(game.kickoffAt)}>
          <form.Field name="kickoffAt">
            {(field) => (
              <FormDateTimeField
                field={field}
                id={`game-${game.id}-overrideKickoffAt`}
                label="Kickoff override"
              />
            )}
          </form.Field>
        </ProviderHint>

        <ProviderHint provider={gameStatusLabel(game.status)}>
          <form.Field name="status">
            {(field) => (
              <LabeledSelect
                id={`game-${game.id}-overrideStatus`}
                label="Status override"
                value={field.state.value}
                onValueChange={field.handleChange}
                options={STATUS_OPTIONS}
              />
            )}
          </form.Field>
        </ProviderHint>

        <ProviderHint provider={scoreHint(game.homeScore)}>
          <form.Field name="homeScore">
            {(field) => (
              <FormTextField
                field={field}
                id={`game-${game.id}-overrideHomeScore`}
                label={`${game.homeTeam.abbreviation} score override`}
                inputMode="numeric"
              />
            )}
          </form.Field>
        </ProviderHint>

        <ProviderHint provider={scoreHint(game.awayScore)}>
          <form.Field name="awayScore">
            {(field) => (
              <FormTextField
                field={field}
                id={`game-${game.id}-overrideAwayScore`}
                label={`${game.awayTeam.abbreviation} score override`}
                inputMode="numeric"
              />
            )}
          </form.Field>
        </ProviderHint>

        <ProviderHint provider={game.spread === null ? "no line" : String(game.spread)}>
          <form.Field name="spread">
            {(field) => (
              <FormTextField
                field={field}
                id={`game-${game.id}-overrideSpread`}
                label="Spread override"
                inputMode="decimal"
              />
            )}
          </form.Field>
        </ProviderHint>

        <ProviderHint provider={periodHint(game.period)}>
          <form.Field name="period">
            {(field) => (
              <FormTextField
                field={field}
                id={`game-${game.id}-overridePeriod`}
                label="Period override"
                inputMode="numeric"
              />
            )}
          </form.Field>
        </ProviderHint>

        <ProviderHint provider={clockHint(game.clockSeconds)}>
          <form.Field name="clock">
            {(field) => (
              <FormTextField
                field={field}
                id={`game-${game.id}-overrideClock`}
                label="Clock override (m:ss)"
                placeholder="12:34"
              />
            )}
          </form.Field>
        </ProviderHint>
      </div>

      {/* Gated on a real change (same idiom as the sim fixture editor): an
          untouched save would be a no-op round trip that re-settles every
          affected league for nothing. */}
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={pending || !isGameOverrideFormDirty(seed, values)}
          >
            Save override
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
