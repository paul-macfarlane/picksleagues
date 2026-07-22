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
  PICK_TYPE,
  PICKEM_PUSH_TIE_RESOLUTION,
  WEEK_TYPE,
  type CreateLeagueRequest,
  type EliminationPushTieResolution,
  type LeagueMode,
  type LeagueVisibility,
  type MarchMadnessScoringModel,
  type NflWeekRef,
  type PickType,
  type PickemPushTieResolution,
} from "@picksleagues/schemas";
import { api } from "@/lib/api";
import { FormTextField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authed/leagues/new")({
  component: NewLeague,
});

const MODE_OPTIONS: { value: LeagueMode; label: string }[] = [
  { value: LEAGUE_MODE.PICKEM, label: "NFL Pick'em" },
  { value: LEAGUE_MODE.ELIMINATION, label: "NFL Elimination" },
  { value: LEAGUE_MODE.MARCH_MADNESS, label: "March Madness Pool" },
];

const VISIBILITY_OPTIONS: { value: LeagueVisibility; label: string; description: string }[] = [
  {
    value: LEAGUE_VISIBILITY.PRIVATE,
    label: "Private",
    description: "Invite-only — joinable only via an invite link.",
  },
  {
    value: LEAGUE_VISIBILITY.PUBLIC,
    label: "Public",
    description: "Discoverable and joinable by anyone.",
  },
];

const PICK_TYPE_OPTIONS: { value: PickType; label: string }[] = [
  { value: PICK_TYPE.STRAIGHT_UP, label: "Straight Up" },
  { value: PICK_TYPE.AGAINST_THE_SPREAD, label: "Against the Spread" },
];

const PICKEM_PUSH_TIE_OPTIONS: { value: PickemPushTieResolution; label: string }[] = [
  { value: PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT, label: "+0.5 (default)" },
  { value: PICKEM_PUSH_TIE_RESOLUTION.ZERO_POINTS, label: "0" },
  { value: PICKEM_PUSH_TIE_RESOLUTION.FULL_POINT, label: "+1" },
];

const ELIMINATION_PUSH_TIE_OPTIONS: { value: EliminationPushTieResolution; label: string }[] = [
  { value: ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE, label: "Advance (team consumed)" },
  { value: ELIMINATION_PUSH_TIE_RESOLUTION.ELIMINATE, label: "Eliminate" },
];

const MM_SCORING_MODEL_OPTIONS: { value: MarchMadnessScoringModel; label: string }[] = [
  { value: MARCH_MADNESS_SCORING_MODEL.STANDARD_DOUBLING, label: "Standard Doubling" },
  { value: MARCH_MADNESS_SCORING_MODEL.CUSTOM, label: "Custom" },
];

const MM_ROUND_LABELS = [
  "Round of 64",
  "Round of 32",
  "Sweet 16",
  "Elite Eight",
  "Final Four",
  "Championship",
] as const;

// NFL postseason rounds restart at 1 (spec §Pick'em League Settings), so week
// selects encode both the regular/postseason weeks table's identity —
// `type:number` — into one option value; decodeWeek reverses it.
function encodeWeek(ref: NflWeekRef): string {
  return `${ref.type}:${ref.number}`;
}

function decodeWeek(value: string): NflWeekRef {
  const [type, numberText] = value.split(":");
  return { type, number: Number(numberText) } as NflWeekRef;
}

const REGULAR_WEEK_OPTIONS = Array.from({ length: 18 }, (_, index) => {
  const ref: NflWeekRef = { type: WEEK_TYPE.REGULAR, number: index + 1 };
  return { value: encodeWeek(ref), label: `Week ${index + 1}` };
});

const POSTSEASON_ROUND_LABELS = [
  "Wild Card",
  "Divisional",
  "Conference Championship",
  "Super Bowl",
] as const;

const POSTSEASON_WEEK_OPTIONS = POSTSEASON_ROUND_LABELS.map((label, index) => {
  const ref: NflWeekRef = { type: WEEK_TYPE.POSTSEASON, number: index + 1 };
  return { value: encodeWeek(ref), label };
});

// Pick'em may extend into the playoffs (mvp-spec); Elimination stays
// regular-season, so its week select never offers the postseason options.
const PICKEM_WEEK_OPTIONS = [...REGULAR_WEEK_OPTIONS, ...POSTSEASON_WEEK_OPTIONS];

const DEFAULT_PICKEM_START_WEEK = encodeWeek({ type: WEEK_TYPE.REGULAR, number: 1 });
const DEFAULT_PICKEM_END_WEEK = encodeWeek({ type: WEEK_TYPE.REGULAR, number: 18 });

function NewLeague() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<LeagueMode>(LEAGUE_MODE.PICKEM);
  const [visibility, setVisibility] = useState<LeagueVisibility>(LEAGUE_VISIBILITY.PRIVATE);

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
      // League home page arrives in LG-7 — the dashboard is the deliberate
      // landing spot until then.
      navigate({ to: "/" });
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
      const parsed = CreateLeagueRequestSchema.safeParse({ mode, name, visibility, settings });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Check your league settings.");
        return;
      }

      // Fire-and-forget `mutate`: form-core re-throws an awaited rejection out of
      // handleSubmit as an unhandled rejection; the mutation's onError owns failures.
      createLeague.mutate(parsed.data);
    },
  });

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

            {mode === LEAGUE_MODE.PICKEM && (
              <div className="flex flex-col gap-4">
                <h2 className="text-sm font-semibold text-foreground">Pick&apos;em settings</h2>
                <div className="grid grid-cols-2 gap-3">
                  <WeekSelect
                    id="pickem-start-week"
                    label="Start week"
                    value={pickemStartWeek}
                    onValueChange={setPickemStartWeek}
                    options={PICKEM_WEEK_OPTIONS}
                  />
                  <WeekSelect
                    id="pickem-end-week"
                    label="End week"
                    value={pickemEndWeek}
                    onValueChange={setPickemEndWeek}
                    options={PICKEM_WEEK_OPTIONS}
                  />
                </div>
                <RadioField
                  legend="Pick type"
                  name="pickem-pick-type"
                  value={pickemPickType}
                  onValueChange={setPickemPickType}
                  options={PICK_TYPE_OPTIONS}
                />
                <NumberField
                  id="pickem-picks-per-week"
                  label="Picks per week"
                  min={1}
                  max={16}
                  value={pickemPicksPerWeek}
                  onValueChange={setPickemPicksPerWeek}
                />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pickem-push-tie">Push / tie value</Label>
                  <Select
                    value={pickemPushTie}
                    onValueChange={(next) => {
                      if (next) setPickemPushTie(next);
                    }}
                  >
                    <SelectTrigger id="pickem-push-tie" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PICKEM_PUSH_TIE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {mode === LEAGUE_MODE.ELIMINATION && (
              <div className="flex flex-col gap-4">
                <h2 className="text-sm font-semibold text-foreground">Elimination settings</h2>
                <div className="grid grid-cols-2 gap-3">
                  <WeekSelect
                    id="elimination-start-week"
                    label="Start week"
                    value={eliminationStartWeek}
                    onValueChange={setEliminationStartWeek}
                    options={REGULAR_WEEK_OPTIONS}
                  />
                  <WeekSelect
                    id="elimination-end-week"
                    label="End week"
                    value={eliminationEndWeek}
                    onValueChange={setEliminationEndWeek}
                    options={REGULAR_WEEK_OPTIONS}
                  />
                </div>
                <RadioField
                  legend="Pick type"
                  name="elimination-pick-type"
                  value={eliminationPickType}
                  onValueChange={setEliminationPickType}
                  options={PICK_TYPE_OPTIONS}
                />
                <RadioField
                  legend="Push / tie result"
                  name="elimination-push-tie"
                  value={eliminationPushTie}
                  onValueChange={setEliminationPushTie}
                  options={ELIMINATION_PUSH_TIE_OPTIONS}
                />
              </div>
            )}

            {mode === LEAGUE_MODE.MARCH_MADNESS && (
              <div className="flex flex-col gap-4">
                <h2 className="text-sm font-semibold text-foreground">
                  March Madness Pool settings
                </h2>
                <NumberField
                  id="mm-max-brackets"
                  label="Max brackets per member"
                  min={1}
                  max={10}
                  value={mmMaxBrackets}
                  onValueChange={setMmMaxBrackets}
                />
                <RadioField
                  legend="Scoring model"
                  name="mm-scoring-model"
                  value={mmScoringModel}
                  onValueChange={setMmScoringModel}
                  options={MM_SCORING_MODEL_OPTIONS}
                />
                {mmScoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM && (
                  <div className="grid grid-cols-2 gap-3">
                    {MM_ROUND_LABELS.map((label, index) => (
                      <NumberField
                        key={label}
                        id={`mm-round-value-${index}`}
                        label={label}
                        min={0}
                        value={mmRoundValues[index] ?? 0}
                        onValueChange={(next) =>
                          setMmRoundValues((prev) =>
                            prev.map((value, i) => (i === index ? next : value)),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                size="lg"
                className="w-full justify-center"
                disabled={createLeague.isPending}
              >
                {createLeague.isPending ? "Creating…" : "Create league"}
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

// Shared radio-group wiring: a legend, then one Radio + Label pair per
// option (with optional helper text) — used for mode, visibility, pick
// type, and both modes' push/tie settings.
function RadioField<Value extends string>({
  legend,
  name,
  value,
  onValueChange,
  options,
}: {
  legend: string;
  name: string;
  value: Value;
  onValueChange: (value: Value) => void;
  options: { value: Value; label: string; description?: string }[];
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>
      <RadioGroup name={name} value={value} onValueChange={(next) => onValueChange(next as Value)}>
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <RadioGroupItem value={option.value} id={id} className="mt-0.5" />
              <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
                <span>{option.label}</span>
                {option.description && (
                  <span className="font-normal text-xs text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

// Shared week-select wiring for start/end week pairs across Pick'em and
// Elimination — options carry the encodeWeek/decodeWeek round-trip value.
function WeekSelect({
  id,
  label,
  value,
  onValueChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Shared numeric-input wiring for picksPerWeek / maxBracketsPerMember /
// custom round values. NaN (a transiently-cleared field) is ignored rather
// than propagated — the assembled settings must always parse as a number.
function NumberField({
  id,
  label,
  value,
  onValueChange,
  min,
  max,
}: {
  id: string;
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (!Number.isNaN(next)) onValueChange(next);
        }}
      />
    </div>
  );
}
