import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
  CreateLeagueRequestSchema,
  DEFAULT_MAX_MEMBERS,
  SURVIVOR_EVERYONE_OUT,
  SURVIVOR_PUSH_TIE_RESOLUTION,
  LEAGUE_MODE,
  LEAGUE_VISIBILITY,
  LeagueNameSchema,
  MARCH_MADNESS_SCORING_MODEL,
  MAX_LEAGUE_SIZE,
  PICK_TYPE,
  type SurvivorEveryoneOut,
  type SurvivorPushTieResolution,
  type LeagueMode,
  type LeagueVisibility,
  type MarchMadnessScoringModel,
  type PickType,
  type PickemSeasonRangePreset,
} from "@picksleagues/schemas";
import { useCreateLeague } from "@/api/leagues";
import { usePickemSeasonRangePresets } from "@/api/pickem";
import { leagueModeLabel } from "@/lib/league";
import {
  DEFAULT_PICKEM_SEASON_RANGE,
  SurvivorSettingsFields,
  MarchMadnessSettingsFields,
  PICKEM_SEASON_RANGE_OPTIONS,
  PickemSettingsFields,
  RadioField,
  VISIBILITY_OPTIONS,
} from "@/components/league-settings-fields";
import { FormTextField } from "@/components/form-field";
import { NumberField, numberFieldInvalid } from "@/components/number-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/leagues/new")({
  component: NewLeague,
});

const MODE_OPTIONS: { value: LeagueMode; label: string }[] = [
  { value: LEAGUE_MODE.PICKEM, label: leagueModeLabel(LEAGUE_MODE.PICKEM) },
  { value: LEAGUE_MODE.SURVIVOR, label: leagueModeLabel(LEAGUE_MODE.SURVIVOR) },
  { value: LEAGUE_MODE.MARCH_MADNESS, label: leagueModeLabel(LEAGUE_MODE.MARCH_MADNESS) },
];

function NewLeague() {
  // Stated deviation from the TanStack-Form rule: everything below is
  // select/radio/stepper state with no per-field validation to run — the
  // schemas constrain the option sets, and the assembled union is parsed once
  // at submit. Free-text entry (the name field) does go through TanStack Form.
  const [mode, setMode] = useState<LeagueMode>(LEAGUE_MODE.PICKEM);
  const [visibility, setVisibility] = useState<LeagueVisibility>(LEAGUE_VISIBILITY.PRIVATE);
  const [maxMembers, setMaxMembers] = useState(DEFAULT_MAX_MEMBERS);

  const [pickemSeasonRange, setPickemSeasonRange] = useState<PickemSeasonRangePreset>(
    DEFAULT_PICKEM_SEASON_RANGE,
  );
  const [pickemPickType, setPickemPickType] = useState<PickType>(PICK_TYPE.STRAIGHT_UP);
  const [pickemPicksPerWeek, setPickemPicksPerWeek] = useState(5);

  const [survivorPushTie, setSurvivorPushTie] = useState<SurvivorPushTieResolution>(
    SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
  );
  const [survivorEveryoneOut, setSurvivorEveryoneOut] = useState<SurvivorEveryoneOut>(
    SURVIVOR_EVERYONE_OUT.REVIVE,
  );

  const [mmMaxBrackets, setMmMaxBrackets] = useState(5);
  const [mmScoringModel, setMmScoringModel] = useState<MarchMadnessScoringModel>(
    MARCH_MADNESS_SCORING_MODEL.STANDARD_DOUBLING,
  );
  const [mmRoundValues, setMmRoundValues] = useState<number[]>([0, 0, 0, 0, 0, 0]);

  const createLeague = useCreateLeague();

  // The create form's answer: which presets the latest ingested NFL season
  // can still start (LG-9, ADR-0020). Pending or failed both fall back to the
  // unfiltered list — the server's `start_week_passed` refusal on submit
  // remains the real enforcement, so a slow or down side query must not block
  // creation, only the informed-choice hint this adds on top of it.
  const seasonRangePresets = usePickemSeasonRangePresets();
  const pickemSeasonRangeOptions = seasonRangePresets.data
    ? PICKEM_SEASON_RANGE_OPTIONS.filter((option) =>
        seasonRangePresets.data.startablePresets.includes(option.value),
      )
    : PICKEM_SEASON_RANGE_OPTIONS;
  // Derived from state + the offered options on every render, never written
  // back into state via an effect: the submit payload below reads this same
  // expression, so the two can never disagree about which preset is "current"
  // (an effect syncing `pickemSeasonRange` could render one frame where the
  // select and the payload would have differed).
  const effectivePickemSeasonRange: PickemSeasonRangePreset =
    pickemSeasonRangeOptions.find((option) => option.value === pickemSeasonRange)?.value ??
    pickemSeasonRangeOptions[0]?.value ??
    pickemSeasonRange;
  // Only reachable once the query has actually answered "none" — pending and
  // failed both keep the full three-option list above.
  const pickemHasNoStartablePreset =
    mode === LEAGUE_MODE.PICKEM && pickemSeasonRangeOptions.length === 0;

  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      // The field validator below already confirmed this passes
      // LeagueNameSchema — parse again for the canonical (trimmed) value.
      const name = LeagueNameSchema.parse(value.name);

      let settings: unknown;
      if (mode === LEAGUE_MODE.PICKEM) {
        // The preset is the whole range input (ADR-0020): the server resolves
        // it against the bound season and the clock, so naming week refs here
        // would be dropped by the request schema rather than honoured.
        settings = {
          seasonRangePreset: effectivePickemSeasonRange,
          pickType: pickemPickType,
          picksPerWeek: pickemPicksPerWeek,
        };
      } else if (mode === LEAGUE_MODE.SURVIVOR) {
        // The two grading rules are the whole of a Survivor settings request:
        // no range on the wire (ADR-0024, the mode is regular-season only, so
        // the server resolves the refs it stores against the clock) and no pick
        // type (ADR-0026, the mode is straight-up only).
        settings = {
          pushTieResolution: survivorPushTie,
          everyoneOut: survivorEveryoneOut,
        };
      } else {
        settings =
          mmScoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM
            ? {
                maxBracketsPerMember: mmMaxBrackets,
                scoringModel: mmScoringModel,
                roundValues: mmRoundValues,
              }
            : { maxBracketsPerMember: mmMaxBrackets, scoringModel: mmScoringModel };
      }

      // Re-validate the assembled body against the exact contract shape
      // before sending — the union of independently-managed settings state
      // must always satisfy the mode's Zod schema.
      const parsed = CreateLeagueRequestSchema.safeParse({
        mode,
        name,
        visibility,
        maxMembers,
        settings,
      });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Check your league settings.");
        return;
      }

      // Fire-and-forget `mutate`: form-core re-throws an awaited rejection out of
      // handleSubmit as an unhandled rejection; the mutation's onError owns failures.
      createLeague.mutate(parsed.data);
    },
  });

  // Submit gates on every NumberField currently rendered — which fields those
  // are depends on `mode` (Survivor renders none beyond maxMembers).
  const hasInvalidNumberField =
    numberFieldInvalid(maxMembers, 2, MAX_LEAGUE_SIZE) ||
    (mode === LEAGUE_MODE.PICKEM && numberFieldInvalid(pickemPicksPerWeek, 1, 16)) ||
    (mode === LEAGUE_MODE.MARCH_MADNESS &&
      (numberFieldInvalid(mmMaxBrackets, 1, 10) ||
        (mmScoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM &&
          mmRoundValues.some((roundValue) => numberFieldInvalid(roundValue, 0)))));

  return (
    <main className="flex flex-1 flex-col items-center gap-4 p-4 sm:p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Create a league</CardTitle>
          <CardDescription>
            Choose a game mode, name your league, and set its rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
            noValidate
          >
            <RadioField
              legend="Game mode"
              name="mode"
              value={mode}
              onValueChange={setMode}
              options={MODE_OPTIONS}
            />

            <form.Field name="name" validators={{ onSubmit: LeagueNameSchema }}>
              {(field) => <FormTextField field={field} label="League name" autoFocus />}
            </form.Field>

            <RadioField
              legend="Visibility"
              name="visibility"
              value={visibility}
              onValueChange={setVisibility}
              options={VISIBILITY_OPTIONS}
            />

            <NumberField
              id="max-members"
              label="Max members"
              description="Anywhere from 2 to 100 members."
              min={2}
              max={MAX_LEAGUE_SIZE}
              value={maxMembers}
              onValueChange={setMaxMembers}
            />

            {mode === LEAGUE_MODE.PICKEM &&
              (pickemHasNoStartablePreset ? (
                <div className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold text-foreground">Pick&apos;em settings</h2>
                  <p className="text-sm text-muted-foreground">
                    None of Pick&apos;em&apos;s season ranges can still be started for the current
                    NFL season. Check back once next season&apos;s schedule is posted, or choose a
                    different mode.
                  </p>
                </div>
              ) : (
                <PickemSettingsFields
                  seasonRange={effectivePickemSeasonRange}
                  onSeasonRangeChange={setPickemSeasonRange}
                  seasonRangeOptions={pickemSeasonRangeOptions}
                  pickType={pickemPickType}
                  onPickTypeChange={setPickemPickType}
                  picksPerWeek={pickemPicksPerWeek}
                  onPicksPerWeekChange={setPickemPicksPerWeek}
                />
              ))}

            {mode === LEAGUE_MODE.SURVIVOR && (
              <SurvivorSettingsFields
                pushTie={survivorPushTie}
                onPushTieChange={setSurvivorPushTie}
                everyoneOut={survivorEveryoneOut}
                onEveryoneOutChange={setSurvivorEveryoneOut}
              />
            )}

            {mode === LEAGUE_MODE.MARCH_MADNESS && (
              <MarchMadnessSettingsFields
                maxBrackets={mmMaxBrackets}
                onMaxBracketsChange={setMmMaxBrackets}
                scoringModel={mmScoringModel}
                onScoringModelChange={setMmScoringModel}
                roundValues={mmRoundValues}
                onRoundValueChange={(index, next) =>
                  setMmRoundValues((prev) => prev.map((value, i) => (i === index ? next : value)))
                }
              />
            )}

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                size="lg"
                className="w-full justify-center"
                disabled={
                  createLeague.isPending || hasInvalidNumberField || pickemHasNoStartablePreset
                }
              >
                Create league
              </Button>
              <Link
                to="/"
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: "w-full justify-center",
                })}
              >
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
