import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { SIM_FINAL_STATUS, WEEK_TYPE, type SimFixtureGame } from "@picksleagues/schemas";
import { useUpdateSimFixtureGame } from "@/api/sim";
import { formatDateTime } from "@/lib/format";
import { gameStatusLabel, scoreText, weekTypeLabel } from "@/lib/game";
import {
  buildFixturePatch,
  fixtureFormSeed,
  isFixtureFormDirty,
} from "@/components/sim/fixture-patch";
import { FormTextField } from "@/components/form-field";
import { LabeledSelect } from "@/components/labeled-select";
import { Button } from "@/components/ui/button";

// The bound `UpdateSimFixtureGameRequestSchema.weekType`/`finalStatus` accept —
// derived from the const objects (never a restated literal list) so the
// dropdowns can't drift from the wire schema.
const WEEK_TYPE_OPTIONS = Object.values(WEEK_TYPE).map((weekType) => ({
  value: weekType,
  label: weekTypeLabel(weekType),
}));
const FINAL_STATUS_OPTIONS = Object.values(SIM_FINAL_STATUS).map((status) => ({
  value: status,
  label: gameStatusLabel(status),
}));

function FixtureEditForm({ game }: { game: SimFixtureGame }) {
  const updateFixture = useUpdateSimFixtureGame();
  // Captured once, deliberately not re-derived from `game`: the seed is both
  // what the operator was shown and the baseline every save diffs against, so
  // a refetch mid-edit must not silently move it (same non-re-seeding rationale
  // as the clock card's instant field).
  const [seed] = useState(() => fixtureFormSeed(game));

  const form = useForm({
    defaultValues: seed,
    onSubmit: ({ value }) => {
      const result = buildFixturePatch(seed, value);
      if (result.status === "unchanged") return;
      if (result.status === "invalid") {
        // Field errors, not a toast: these are per-input problems the operator
        // fixes in place. The service's own 400 stays reserved for a *coherent*
        // refusal (a final fixture needs both scores), which is cross-field.
        form.setErrorMap({ onSubmit: { fields: result.fieldErrors } });
        return;
      }
      updateFixture.mutate({ gameId: game.id, patch: result.patch });
    },
  });

  const pending = updateFixture.isPending;

  return (
    <form
      className="mt-2 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Fire-and-forget: form-core re-throws an awaited rejection out of
        // handleSubmit as an unhandled rejection; the mutation's own
        // toast/invalidation (api/sim.ts) owns success and failure.
        void form.handleSubmit();
      }}
      noValidate
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form.Field name="kickoffAt">
          {(field) => (
            <FormTextField
              field={field}
              id={`fixture-${game.id}-kickoffAt`}
              label="Kickoff"
              type="datetime-local"
            />
          )}
        </form.Field>
        <form.Field name="weekType">
          {(field) => (
            <LabeledSelect
              id={`fixture-${game.id}-weekType`}
              label="Week type"
              value={field.state.value}
              onValueChange={field.handleChange}
              options={WEEK_TYPE_OPTIONS}
            />
          )}
        </form.Field>
        <form.Field name="weekNumber">
          {(field) => (
            <FormTextField
              field={field}
              id={`fixture-${game.id}-weekNumber`}
              label="Week number"
              inputMode="numeric"
            />
          )}
        </form.Field>
        <form.Field name="spread">
          {(field) => (
            <FormTextField
              field={field}
              id={`fixture-${game.id}-spread`}
              label="Spread"
              inputMode="decimal"
            />
          )}
        </form.Field>
        <form.Field name="finalStatus">
          {(field) => (
            <LabeledSelect
              id={`fixture-${game.id}-finalStatus`}
              label="Final status"
              value={field.state.value}
              onValueChange={field.handleChange}
              options={FINAL_STATUS_OPTIONS}
            />
          )}
        </form.Field>
        <form.Field name="finalHomeScore">
          {(field) => (
            <FormTextField
              field={field}
              id={`fixture-${game.id}-finalHomeScore`}
              label="Final home score"
              inputMode="numeric"
            />
          )}
        </form.Field>
        <form.Field name="finalAwayScore">
          {(field) => (
            <FormTextField
              field={field}
              id={`fixture-${game.id}-finalAwayScore`}
              label="Final away score"
              inputMode="numeric"
            />
          )}
        </form.Field>
      </div>
      {/* Gated on a real change (same idiom as the profile form): an untouched
          save would be a no-op round trip, and every field it sent would be a
          chance to write back a value the operator never looked at. */}
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={pending || !isFixtureFormDirty(seed, values)}
          >
            Save
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

export function SimFixtureRow({ game }: { game: SimFixtureGame }) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p
        className="text-sm font-medium text-foreground"
        title={`${game.awayTeamName} @ ${game.homeTeamName}`}
      >
        {game.awayTeamAbbr} @ {game.homeTeamAbbr}
      </p>

      <div className="flex flex-col gap-1 text-xs text-foreground">
        <span>Kickoff {formatDateTime(game.kickoffAt)}</span>
        <span>
          {weekTypeLabel(game.weekType)} week {game.weekNumber}
        </span>
        <span>Spread {game.spread === null ? "no line" : String(game.spread)}</span>
        <span>
          Final: {gameStatusLabel(game.finalStatus)}
          {scoreText(game.finalAwayScore, game.finalHomeScore)}
        </span>
        {/* The provider's read at the current simulated now — `scheduled`/
            `in_progress` until the clock passes this game's kickoff
            (ADR-0012), which is the whole reason this browser exists. */}
        <span>
          Projected: {gameStatusLabel(game.projectedStatus)}
          {scoreText(game.projectedAwayScore, game.projectedHomeScore)}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">provider game id {game.providerGameId}</p>

      <details open={editOpen} onToggle={(event) => setEditOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs text-muted-foreground select-none">Edit</summary>
        {editOpen && <FixtureEditForm game={game} />}
      </details>
    </li>
  );
}
