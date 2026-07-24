import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  LEAGUE_VISIBILITY,
  MARCH_MADNESS_SCORING_MODEL,
  PICK_TYPE,
  PICKEM_PUSH_TIE_RESOLUTION,
  WEEK_TYPE,
  type EliminationPushTieResolution,
  type LeagueVisibility,
  type MarchMadnessScoringModel,
  type NflWeekRef,
  type PickType,
  type PickemPushTieResolution,
} from "@picksleagues/schemas";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export const PICKEM_PUSH_TIE_OPTIONS: { value: PickemPushTieResolution; label: string }[] = [
  { value: PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT, label: "+0.5 (default)" },
  { value: PICKEM_PUSH_TIE_RESOLUTION.ZERO_POINTS, label: "0" },
  { value: PICKEM_PUSH_TIE_RESOLUTION.FULL_POINT, label: "+1" },
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

// NFL postseason rounds restart at 1 (spec §Pick'em League Settings), so week
// selects encode both the regular/postseason weeks table's identity —
// `type:number` — into one option value; decodeWeek reverses it.
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
export const PICKEM_WEEK_OPTIONS = [...REGULAR_WEEK_OPTIONS, ...POSTSEASON_WEEK_OPTIONS];

export const DEFAULT_PICKEM_START_WEEK = encodeWeek({ type: WEEK_TYPE.REGULAR, number: 1 });
export const DEFAULT_PICKEM_END_WEEK = encodeWeek({ type: WEEK_TYPE.REGULAR, number: 18 });

// Shared radio-group wiring: a legend, then one Radio + Label pair per
// option (with optional helper text) — used for mode, visibility, pick
// type, and both modes' push/tie settings.
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

// Shared week-select wiring for start/end week pairs across Pick'em and
// Elimination — options carry the encodeWeek/decodeWeek round-trip value.
export function WeekSelect({
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
      {/* `items` is Base UI's value→label map for the closed trigger — without
          it, Select.Value renders the raw wire value ("regular:1") instead of
          the option label ("Week 1"). Since options are already `{value, label}`,
          Base UI reads the label straight off them, no `itemToStringLabel` needed. */}
      <Select
        items={options}
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

export function PickemSettingsFields({
  startWeek,
  onStartWeekChange,
  endWeek,
  onEndWeekChange,
  pickType,
  onPickTypeChange,
  picksPerWeek,
  onPicksPerWeekChange,
  pushTie,
  onPushTieChange,
}: {
  startWeek: string;
  onStartWeekChange: (value: string) => void;
  endWeek: string;
  onEndWeekChange: (value: string) => void;
  pickType: PickType;
  onPickTypeChange: (value: PickType) => void;
  picksPerWeek: number;
  onPicksPerWeekChange: (value: number) => void;
  pushTie: PickemPushTieResolution;
  onPushTieChange: (value: PickemPushTieResolution) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">Pick&apos;em settings</h2>
      <div className="grid grid-cols-2 gap-3">
        <WeekSelect
          id="pickem-start-week"
          label="Start week"
          value={startWeek}
          onValueChange={onStartWeekChange}
          options={PICKEM_WEEK_OPTIONS}
        />
        <WeekSelect
          id="pickem-end-week"
          label="End week"
          value={endWeek}
          onValueChange={onEndWeekChange}
          options={PICKEM_WEEK_OPTIONS}
        />
      </div>
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pickem-push-tie">Push / tie value</Label>
        <Select
          items={PICKEM_PUSH_TIE_OPTIONS}
          value={pushTie}
          onValueChange={(next) => {
            if (next) onPushTieChange(next);
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
        <WeekSelect
          id="elimination-start-week"
          label="Start week"
          value={startWeek}
          onValueChange={onStartWeekChange}
          options={REGULAR_WEEK_OPTIONS}
        />
        <WeekSelect
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
