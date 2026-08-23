import { useState } from "react";
import { MatchupLine, MatchupSide } from "@/components/league/matchup-line";
import { LabeledValue } from "@/components/labeled-value";
import { RowEditor } from "@/components/row-editor";
import { cn } from "@/lib/utils";
import { rowClassName } from "@/components/row";
import { useForm } from "@tanstack/react-form";
import { SIM_FINAL_STATUS, WEEK_TYPE, type SimFixtureGame } from "@picksleagues/schemas";
import { useUpdateSimFixtureGame } from "@/api/sim";
import { formatDateTime } from "@/lib/format";
import { gameStatusLabel, matchupNumerals, scoreText, weekTypeLabel } from "@/lib/game";
import {
  buildFixturePatch,
  fixtureFormSeed,
  isFixtureFormDirty,
} from "@/components/sim/fixture-patch";
import { FormDateTimeField } from "@/components/form-date-time-field";
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
            <FormDateTimeField field={field} id={`fixture-${game.id}-kickoffAt`} label="Kickoff" />
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
  // The numeral slot holds the fixture's *terminal* truth — the final score
  // once the fixture has one, the spread otherwise — not the projection: the
  // projection is what the provider is saying at the simulated now, and the
  // labelled line beneath keeps it beside the final so the two can be read
  // against each other (ADR-0012).
  const numerals = matchupNumerals(
    { status: game.finalStatus, awayScore: game.finalAwayScore, homeScore: game.finalHomeScore },
    game.spread,
  );
  const away = { abbreviation: game.awayTeamAbbr, name: game.awayTeamName };
  const home = { abbreviation: game.homeTeamAbbr, name: game.homeTeamName };

  return (
    <li className={cn(rowClassName, "flex flex-col gap-2")}>
      <MatchupLine
        away={<MatchupSide team={away} numeral={numerals.away} side="away" />}
        center={formatDateTime(game.kickoffAt)}
        home={<MatchupSide team={home} numeral={numerals.home} side="home" />}
      />

      <div className="flex flex-col gap-1 text-xs text-foreground">
        <LabeledValue label="Week">
          <span>
            {weekTypeLabel(game.weekType)} {game.weekNumber}
          </span>
        </LabeledValue>
        <LabeledValue label="Final">
          <span>
            {gameStatusLabel(game.finalStatus)}
            {scoreText(game.finalAwayScore, game.finalHomeScore)}
          </span>
        </LabeledValue>
        {/* The provider's read at the current simulated now — `scheduled`/
            `in_progress` until the clock passes this game's kickoff
            (ADR-0012), which is the whole reason this browser exists. */}
        <LabeledValue label="Projected">
          <span>
            {gameStatusLabel(game.projectedStatus)}
            {scoreText(game.projectedAwayScore, game.projectedHomeScore)}
          </span>
        </LabeledValue>
      </div>

      <p className="text-xs text-muted-foreground">provider game id {game.providerGameId}</p>

      <RowEditor label="Edit">
        <FixtureEditForm game={game} />
      </RowEditor>
    </li>
  );
}
