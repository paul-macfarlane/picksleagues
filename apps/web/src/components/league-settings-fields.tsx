import {
  NFL_REGULAR_SEASON_RANGE,
  LEAGUE_VISIBILITY,
  PICK_TYPE,
  type LeagueVisibility,
  type NflSeasonRange,
  type PickType,
} from "@picksleagues/schemas";
import { pickTypeLabel } from "@/lib/league";
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
  PICK_TYPE.STRAIGHT_UP,
  PICK_TYPE.AGAINST_THE_SPREAD,
].map((value) => ({ value, label: pickTypeLabel(value) }));

/**
 * Shared radio-group wiring: a legend, then one Radio + Label pair per
 * option (with optional helper text) — used for mode, visibility, and
 * Pick'em's pick type.
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
      <h2 className="text-sm">Pick&apos;em settings</h2>
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
 * Nothing here is a control: Survivor has no rule settings left — no Pick Type
 * (ADR-0026), no Push/Tie Resolution (ADR-0033, fixed at advance with the
 * team consumed), and a server-resolved season range (ADR-0024). The fieldset
 * survives to state the range, because the covered weeks drive the join
 * cutoff and the last week that scores.
 */
export function SurvivorSettingsFields({ seasonRange }: { seasonRange?: NflSeasonRange }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm">Survivor settings</h2>
      <NflSeasonRangeReadout seasonRange={seasonRange} />
    </div>
  );
}

/**
 * Scoring is standard doubling only (ADR-0034) — max brackets is the one
 * setting the mode has.
 */
export function MarchMadnessSettingsFields({
  maxBrackets,
  onMaxBracketsChange,
}: {
  maxBrackets: number;
  onMaxBracketsChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm">March Madness Pool settings</h2>
      <NumberField
        id="mm-max-brackets"
        label="Max brackets per member"
        min={1}
        max={10}
        value={maxBrackets}
        onValueChange={onMaxBracketsChange}
      />
    </div>
  );
}
