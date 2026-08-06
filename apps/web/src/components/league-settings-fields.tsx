import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  LEAGUE_VISIBILITY,
  MARCH_MADNESS_SCORING_MODEL,
  PICK_TYPE,
  PICKEM_SEASON_RANGE_PRESET,
  WEEK_TYPE,
  type EliminationPushTieResolution,
  type LeagueVisibility,
  type MarchMadnessScoringModel,
  type NflWeekRef,
  type PickType,
  type PickemSeasonRangePreset,
} from "@picksleagues/schemas";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { LabeledSelect } from "@/components/labeled-select";
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

export const ELIMINATION_PUSH_TIE_OPTIONS: {
  value: EliminationPushTieResolution;
  label: string;
}[] = [
  { value: ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE, label: "Advance (team consumed)" },
  { value: ELIMINATION_PUSH_TIE_RESOLUTION.ELIMINATE, label: "Eliminate" },
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

// Pick'em names its season range by preset, never by week numbers (ADR-0020):
// the server resolves the concrete refs against the bound season and the clock,
// so there is nothing here for a commissioner to spell out week by week.
export const PICKEM_SEASON_RANGE_OPTIONS: {
  value: PickemSeasonRangePreset;
  label: string;
}[] = [
  { value: PICKEM_SEASON_RANGE_PRESET.REGULAR_SEASON, label: "Regular Season" },
  { value: PICKEM_SEASON_RANGE_PRESET.POSTSEASON, label: "Postseason" },
  { value: PICKEM_SEASON_RANGE_PRESET.FULL_SEASON, label: "Full Season" },
];

// Matches the range weeks 1-18 described before presets existed, so a league
// created without touching this control covers what it always did.
export const DEFAULT_PICKEM_SEASON_RANGE = PICKEM_SEASON_RANGE_PRESET.REGULAR_SEASON;

// NFL postseason rounds restart at 1 (spec §Pick'em League Settings), so week
// selects encode both the regular/postseason weeks table's identity —
// `type:number` — into one option value; decodeWeek reverses it. Elimination is
// the only mode that still addresses weeks directly (ADR-0020 §Scope defers
// presets there to epic 06).
export function encodeWeek(ref: NflWeekRef): string {
  return `${ref.type}:${ref.number}`;
}

export function decodeWeek(value: string): NflWeekRef {
  const [type, numberText] = value.split(":");
  return { type, number: Number(numberText) } as NflWeekRef;
}

export const REGULAR_WEEK_OPTIONS = Array.from({ length: 18 }, (_, index) => {
  const ref: NflWeekRef = { type: WEEK_TYPE.REGULAR, number: index + 1 };
  return { value: encodeWeek(ref), label: `Week ${index + 1}` };
});

// Elimination is regular-season only (spec §Elimination Core Rules), so its
// week selects never offer a postseason round.
export const DEFAULT_ELIMINATION_START_WEEK = encodeWeek({ type: WEEK_TYPE.REGULAR, number: 1 });
export const DEFAULT_ELIMINATION_END_WEEK = encodeWeek({ type: WEEK_TYPE.REGULAR, number: 18 });

// Shared radio-group wiring: a legend, then one Radio + Label pair per
// option (with optional helper text) — used for mode, visibility, pick
// type, and Elimination's push/tie setting.
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

export function PickemSettingsFields({
  seasonRange,
  onSeasonRangeChange,
  pickType,
  onPickTypeChange,
  picksPerWeek,
  onPicksPerWeekChange,
}: {
  seasonRange: PickemSeasonRangePreset;
  onSeasonRangeChange: (value: PickemSeasonRangePreset) => void;
  pickType: PickType;
  onPickTypeChange: (value: PickType) => void;
  picksPerWeek: number;
  onPicksPerWeekChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">Pick&apos;em settings</h2>
      <LabeledSelect
        id="pickem-season-range"
        label="Season range"
        value={seasonRange}
        onValueChange={onSeasonRangeChange}
        options={PICKEM_SEASON_RANGE_OPTIONS}
      />
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

export function EliminationSettingsFields({
  startWeek,
  onStartWeekChange,
  endWeek,
  onEndWeekChange,
  pickType,
  onPickTypeChange,
  pushTie,
  onPushTieChange,
}: {
  startWeek: string;
  onStartWeekChange: (value: string) => void;
  endWeek: string;
  onEndWeekChange: (value: string) => void;
  pickType: PickType;
  onPickTypeChange: (value: PickType) => void;
  pushTie: EliminationPushTieResolution;
  onPushTieChange: (value: EliminationPushTieResolution) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">Elimination settings</h2>
      <div className="grid grid-cols-2 gap-3">
        <LabeledSelect
          id="elimination-start-week"
          label="Start week"
          value={startWeek}
          onValueChange={onStartWeekChange}
          options={REGULAR_WEEK_OPTIONS}
        />
        <LabeledSelect
          id="elimination-end-week"
          label="End week"
          value={endWeek}
          onValueChange={onEndWeekChange}
          options={REGULAR_WEEK_OPTIONS}
        />
      </div>
      <RadioField
        legend="Pick type"
        name="elimination-pick-type"
        value={pickType}
        onValueChange={onPickTypeChange}
        options={PICK_TYPE_OPTIONS}
      />
      <RadioField
        legend="Push / tie result"
        name="elimination-push-tie"
        value={pushTie}
        onValueChange={onPushTieChange}
        options={ELIMINATION_PUSH_TIE_OPTIONS}
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
