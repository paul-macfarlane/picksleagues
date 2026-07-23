import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
  CreateLeagueRequestSchema,
  ELIMINATION_PUSH_TIE_RESOLUTION,
  LEAGUE_MODE,
  LEAGUE_VISIBILITY,
  LeagueNameSchema,
  MARCH_MADNESS_SCORING_MODEL,
  MAX_LEAGUE_SIZE,
  PICK_TYPE,
  PICKEM_PUSH_TIE_RESOLUTION,
  type CreateLeagueRequest,
  type EliminationPushTieResolution,
  type LeagueMode,
  type LeagueVisibility,
  type MarchMadnessScoringModel,
  type PickType,
  type PickemPushTieResolution,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { leagueModeLabel } from "@/lib/league";
import {
  DEFAULT_PICKEM_END_WEEK,
  DEFAULT_PICKEM_START_WEEK,
  EliminationSettingsFields,
  MarchMadnessSettingsFields,
  PickemSettingsFields,
  RadioField,
  VISIBILITY_OPTIONS,
  decodeWeek,
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
  { value: LEAGUE_MODE.ELIMINATION, label: leagueModeLabel(LEAGUE_MODE.ELIMINATION) },
  { value: LEAGUE_MODE.MARCH_MADNESS, label: leagueModeLabel(LEAGUE_MODE.MARCH_MADNESS) },
];

function NewLeague() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Stated deviation from the TanStack-Form rule: everything below is
  // select/radio/stepper state with no per-field validation to run — the
  // schemas constrain the option sets, and the assembled union is parsed once
  // at submit. Free-text entry (the name field) does go through TanStack Form.
  const [mode, setMode] = useState<LeagueMode>(LEAGUE_MODE.PICKEM);
  const [visibility, setVisibility] = useState<LeagueVisibility>(LEAGUE_VISIBILITY.PRIVATE);
  const [maxMembers, setMaxMembers] = useState(MAX_LEAGUE_SIZE);

  const [pickemStartWeek, setPickemStartWeek] = useState(DEFAULT_PICKEM_START_WEEK);
  const [pickemEndWeek, setPickemEndWeek] = useState(DEFAULT_PICKEM_END_WEEK);
  const [pickemPickType, setPickemPickType] = useState<PickType>(PICK_TYPE.STRAIGHT_UP);
  const [pickemPicksPerWeek, setPickemPicksPerWeek] = useState(5);
  const [pickemPushTie, setPickemPushTie] = useState<PickemPushTieResolution>(
    PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT,
  );

  const [eliminationStartWeek, setEliminationStartWeek] = useState(DEFAULT_PICKEM_START_WEEK);
  const [eliminationEndWeek, setEliminationEndWeek] = useState(DEFAULT_PICKEM_END_WEEK);
  const [eliminationPickType, setEliminationPickType] = useState<PickType>(PICK_TYPE.STRAIGHT_UP);
  const [eliminationPushTie, setEliminationPushTie] = useState<EliminationPushTieResolution>(
    ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE,
  );

  const [mmMaxBrackets, setMmMaxBrackets] = useState(5);
  const [mmScoringModel, setMmScoringModel] = useState<MarchMadnessScoringModel>(
    MARCH_MADNESS_SCORING_MODEL.STANDARD_DOUBLING,
  );
  const [mmRoundValues, setMmRoundValues] = useState<number[]>([0, 0, 0, 0, 0, 0]);

  const createLeague = useMutation({
    mutationFn: async (body: CreateLeagueRequest) => {
      const { data, error, response } = await api.POST("/api/leagues", { body });
      if (error) {
        // cap_exceeded / no_active_season are expected outcomes the server
        // already phrases as a user-facing message — surface it verbatim.
        if (response.status === 409) {
          toast.error(error.message);
          return null;
        }
        throw error;
      }
      return data;
    },
    onSuccess: async (data) => {
      if (!data) return;
      toast.success("League created");
      await queryClient.invalidateQueries({ queryKey: ["my-leagues"] });
      navigate({ to: "/leagues/$leagueId", params: { leagueId: data.id } });
    },
    onError: () => {
      toast.error("Couldn't create that league — please try again.");
    },
  });

  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      // The field validator below already confirmed this passes
      // LeagueNameSchema — parse again for the canonical (trimmed) value.
      const name = LeagueNameSchema.parse(value.name);

      let settings: unknown;
      if (mode === LEAGUE_MODE.PICKEM) {
        settings = {
          startWeek: decodeWeek(pickemStartWeek),
          endWeek: decodeWeek(pickemEndWeek),
          pickType: pickemPickType,
          picksPerWeek: pickemPicksPerWeek,
          pushTieResolution: pickemPushTie,
        };
      } else if (mode === LEAGUE_MODE.ELIMINATION) {
        settings = {
          startWeek: decodeWeek(eliminationStartWeek),
          endWeek: decodeWeek(eliminationEndWeek),
          pickType: eliminationPickType,
          pushTieResolution: eliminationPushTie,
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
  // are depends on `mode` (Elimination renders none beyond maxMembers).
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
              min={2}
              max={MAX_LEAGUE_SIZE}
              value={maxMembers}
              onValueChange={setMaxMembers}
            />

            {mode === LEAGUE_MODE.PICKEM && (
              <PickemSettingsFields
                startWeek={pickemStartWeek}
                onStartWeekChange={setPickemStartWeek}
                endWeek={pickemEndWeek}
                onEndWeekChange={setPickemEndWeek}
                pickType={pickemPickType}
                onPickTypeChange={setPickemPickType}
                picksPerWeek={pickemPicksPerWeek}
                onPicksPerWeekChange={setPickemPicksPerWeek}
                pushTie={pickemPushTie}
                onPushTieChange={setPickemPushTie}
              />
            )}

            {mode === LEAGUE_MODE.ELIMINATION && (
              <EliminationSettingsFields
                startWeek={eliminationStartWeek}
                onStartWeekChange={setEliminationStartWeek}
                endWeek={eliminationEndWeek}
                onEndWeekChange={setEliminationEndWeek}
                pickType={eliminationPickType}
                onPickTypeChange={setEliminationPickType}
                pushTie={eliminationPushTie}
                onPushTieChange={setEliminationPushTie}
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
