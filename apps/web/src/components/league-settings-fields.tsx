import {
  NFL_REGULAR_SEASON_RANGE,
  SURVIVOR_PUSH_TIE_RESOLUTION,
  LEAGUE_VISIBILITY,
  MARCH_MADNESS_SCORING_MODEL,
  PICK_TYPE,
  type SurvivorPushTieResolution,
  type LeagueVisibility,
  type MarchMadnessScoringModel,
  type NflSeasonRange,
  type PickType,
} from "@picksleagues/schemas";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NumberField } from "@/components/number-field";

// Per-mode league settings fieldsets, shared by the create-league form
// (apps/web/src/routes/_authed/leagues/new.tsx) and the league home settings
// editor (apps/web/src/routes/_authed/leagues/$leagueId.tsx) — one home per
// engineering rule ("a file that accretes unrelated responsibilities gets
// split", inverted: don't duplicate a fieldset an existing module already
// covers).

export const VISIBILITY_OPTIONS: { value: LeagueVisibility; label: string; description: string }[] =
  [
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

export const PICK_TYPE_OPTIONS: { value: PickType; label: string }[] = [
  { value: PICK_TYPE.STRAIGHT_UP, label: "Straight Up" },
  { value: PICK_TYPE.AGAINST_THE_SPREAD, label: "Against the Spread" },
];

export const SURVIVOR_PUSH_TIE_OPTIONS: {
  value: SurvivorPushTieResolution;
  label: string;
}[] = [
  { value: SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE, label: "Advance (team consumed)" },
  { value: SURVIVOR_PUSH_TIE_RESOLUTION.ELIMINATE, label: "Eliminate" },
];

export const MM_SCORING_MODEL_OPTIONS: { value: MarchMadnessScoringModel; label: string }[] = [
  { value: MARCH_MADNESS_SCORING_MODEL.STANDARD_DOUBLING, label: "Standard Doubling" },
  { value: MARCH_MADNESS_SCORING_MODEL.CUSTOM, label: "Custom" },
];

export const MM_ROUND_LABELS = [
  "Round of 64",
  "Round of 32",
  "Sweet 16",
  "Elite Eight",
  "Final Four",
  "Championship",
] as const;

/**
 * Shared radio-group wiring: a legend, then one Radio + Label pair per
 * option (with optional helper text) — used for mode, visibility, Pick'em's
 * pick type, and Survivor's push/tie setting.
 */
export function RadioField<Value extends string>({
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

/**
 * The range the league covers, stated rather than chosen: both NFL modes are
 * regular-season only (ADR-0024, ADR-0031), so the one legal range is implicit
 * in the mode and a select would be a required click with a single possible
 * answer. Still shown, because the covered weeks drive the join cutoff and the
 * last week that scores — removing the control is not the same as hiding the
 * answer.
 *
 * `seasonRange` is the league's *stored* resolved refs; the create form has
 * none yet and says what creation will resolve instead.
 */
function NflSeasonRangeReadout({ seasonRange }: { seasonRange?: NflSeasonRange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium text-foreground">Season range</h3>
      <p className="text-sm text-muted-foreground">
        {seasonRange
          ? `Regular season, weeks ${seasonRange.startWeek.number}–${seasonRange.endWeek.number}.`
          : `Regular season, through week ${NFL_REGULAR_SEASON_RANGE.endWeek.number} — starting at the first week that hasn't kicked off yet.`}
      </p>
    </div>
  );
}

export function PickemSettingsFields({
  seasonRange,
  pickType,
  onPickTypeChange,
  picksPerWeek,
  onPicksPerWeekChange,
}: {
  seasonRange?: NflSeasonRange;
  pickType: PickType;
  onPickTypeChange: (value: PickType) => void;
  picksPerWeek: number;
  onPicksPerWeekChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">Pick&apos;em settings</h2>
      <NflSeasonRangeReadout seasonRange={seasonRange} />
      <RadioField
        legend="Pick type"
        name="pickem-pick-type"
        value={pickType}
        onValueChange={onPickTypeChange}
        options={PICK_TYPE_OPTIONS}
      />
      <NumberField
        id="pickem-picks-per-week"
        label="Picks per week"
        min={1}
        max={16}
        value={picksPerWeek}
        onValueChange={onPicksPerWeekChange}
      />
    </div>
  );
}

/**
 * No Pick Type control, and no plan for one: Survivor is straight-up only
 * (ADR-0026).
 */
export function SurvivorSettingsFields({
  seasonRange,
  pushTie,
  onPushTieChange,
}: {
  seasonRange?: NflSeasonRange;
  pushTie: SurvivorPushTieResolution;
  onPushTieChange: (value: SurvivorPushTieResolution) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">Survivor settings</h2>
      <NflSeasonRangeReadout seasonRange={seasonRange} />
      <RadioField
        legend="Push / tie result"
        name="survivor-push-tie"
        value={pushTie}
        onValueChange={onPushTieChange}
        options={SURVIVOR_PUSH_TIE_OPTIONS}
      />
    </div>
  );
}

export function MarchMadnessSettingsFields({
  maxBrackets,
  onMaxBracketsChange,
  scoringModel,
  onScoringModelChange,
  roundValues,
  onRoundValueChange,
}: {
  maxBrackets: number;
  onMaxBracketsChange: (value: number) => void;
  scoringModel: MarchMadnessScoringModel;
  onScoringModelChange: (value: MarchMadnessScoringModel) => void;
  roundValues: number[];
  onRoundValueChange: (index: number, value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">March Madness Pool settings</h2>
      <NumberField
        id="mm-max-brackets"
        label="Max brackets per member"
        min={1}
        max={10}
        value={maxBrackets}
        onValueChange={onMaxBracketsChange}
      />
      <RadioField
        legend="Scoring model"
        name="mm-scoring-model"
        value={scoringModel}
        onValueChange={onScoringModelChange}
        options={MM_SCORING_MODEL_OPTIONS}
      />
      {scoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM && (
        <div className="grid grid-cols-2 gap-3">
          {MM_ROUND_LABELS.map((label, index) => (
            <NumberField
              key={label}
              id={`mm-round-value-${index}`}
              label={label}
              min={0}
              value={roundValues[index] ?? 0}
              onValueChange={(next) => onRoundValueChange(index, next)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
