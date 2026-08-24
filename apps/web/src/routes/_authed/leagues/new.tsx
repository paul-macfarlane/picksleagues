import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
  CreateLeagueRequestSchema,
  DEFAULT_MAX_MEMBERS,
  LEAGUE_MODE,
  LEAGUE_VISIBILITY,
  LeagueNameSchema,
  MAX_LEAGUE_SIZE,
  OFFERED_LEAGUE_MODES,
  PICK_TYPE,
  type LeagueMode,
  type LeagueVisibility,
  type PickType,
} from "@picksleagues/schemas";
import { useCreateLeague } from "@/api/leagues";
import { leagueModeLabel } from "@/lib/league";
import {
  SurvivorSettingsFields,
  MarchMadnessSettingsFields,
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

// Derived from OFFERED_LEAGUE_MODES so hiding a gated mode (LNCH-12: March
// Madness until epic 07) and the server refusing it share one definition.
const MODE_OPTIONS: { value: LeagueMode; label: string }[] = OFFERED_LEAGUE_MODES.map((mode) => ({
  value: mode,
  label: leagueModeLabel(mode),
}));

function NewLeague() {
  // Stated deviation from the TanStack-Form rule: everything below is
  // select/radio/stepper state with no per-field validation to run — the
  // schemas constrain the option sets, and the assembled union is parsed once
  // at submit. Free-text entry (the name field) does go through TanStack Form.
  const [mode, setMode] = useState<LeagueMode>(LEAGUE_MODE.PICKEM);
  const [visibility, setVisibility] = useState<LeagueVisibility>(LEAGUE_VISIBILITY.PRIVATE);
  const [maxMembers, setMaxMembers] = useState(DEFAULT_MAX_MEMBERS);

  const [pickemPickType, setPickemPickType] = useState<PickType>(PICK_TYPE.STRAIGHT_UP);
  const [pickemPicksPerWeek, setPickemPicksPerWeek] = useState(5);

  const [mmMaxBrackets, setMmMaxBrackets] = useState(5);

  const createLeague = useCreateLeague();

  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      // The field validator below already confirmed this passes
      // LeagueNameSchema — parse again for the canonical (trimmed) value.
      const name = LeagueNameSchema.parse(value.name);

      let settings: unknown;
      if (mode === LEAGUE_MODE.PICKEM) {
        // No range on the wire (ADR-0031, matching Survivor below): the mode is
        // regular-season only, so the server resolves the refs it stores
        // against the bound season and the clock, and naming week refs here
        // would be dropped by the request schema rather than honoured.
        settings = {
          pickType: pickemPickType,
          picksPerWeek: pickemPicksPerWeek,
        };
      } else if (mode === LEAGUE_MODE.SURVIVOR) {
        // A Survivor settings request carries nothing at all: the range is
        // resolved server-side (ADR-0024), the pick type is fixed by the mode
        // (ADR-0026), and the push/tie rule is fixed at its default (ADR-0033).
        settings = {};
      } else {
        settings = { maxBracketsPerMember: mmMaxBrackets };
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
    (mode === LEAGUE_MODE.MARCH_MADNESS && numberFieldInvalid(mmMaxBrackets, 1, 10));

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <Card className="w-full max-w-lg self-center">
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

            {mode === LEAGUE_MODE.PICKEM && (
              <PickemSettingsFields
                pickType={pickemPickType}
                onPickTypeChange={setPickemPickType}
                picksPerWeek={pickemPicksPerWeek}
                onPicksPerWeekChange={setPickemPicksPerWeek}
              />
            )}

            {mode === LEAGUE_MODE.SURVIVOR && <SurvivorSettingsFields />}

            {mode === LEAGUE_MODE.MARCH_MADNESS && (
              <MarchMadnessSettingsFields
                maxBrackets={mmMaxBrackets}
                onMaxBracketsChange={setMmMaxBrackets}
              />
            )}

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                size="lg"
                className="w-full justify-center"
                disabled={createLeague.isPending || hasInvalidNumberField}
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
