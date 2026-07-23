import { useState } from "react";
import { Field } from "@base-ui/react/field";
import { toast } from "sonner";
import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  MARCH_MADNESS_SCORING_MODEL,
  MAX_LEAGUE_SIZE,
  PICK_TYPE,
  PICKEM_PUSH_TIE_RESOLUTION,
  LeagueNameSchema,
  type EliminationPushTieResolution,
  type EliminationSettings,
  type LeagueResponse,
  type LeagueVisibility,
  type MarchMadnessScoringModel,
  type MarchMadnessSettings,
  type PickType,
  type PickemPushTieResolution,
  type PickemSettings,
  type UpdateLeagueRequest,
} from "@picksleagues/schemas";
import {
  DEFAULT_PICKEM_END_WEEK,
  DEFAULT_PICKEM_START_WEEK,
  EliminationSettingsFields,
  MarchMadnessSettingsFields,
  PickemSettingsFields,
  RadioField,
  VISIBILITY_OPTIONS,
  decodeWeek,
  encodeWeek,
} from "@/components/league-settings-fields";
import { NumberField, numberFieldInvalid } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateLeagueMutation } from "@/components/league/use-update-league";

export function LeagueSettingsSection({
  league,
  canEdit,
}: {
  league: LeagueResponse;
  canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>League settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Forces a remount (and a fresh derived-state read) whenever any
            editable field changes on the server — the successful-save
            invalidation in use-update-league.ts refetches `league`, and this
            key re-derives every field from it rather than syncing each one
            via a `useEffect` (the effect-free idiom number-field.tsx uses for
            a single prop, applied once for the whole merged form). */}
        <SettingsForm key={settingsFingerprint(league)} league={league} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}

function settingsFingerprint(league: LeagueResponse): string {
  return `${league.name}|${league.visibility}|${league.maxMembers}|${JSON.stringify(league.settings)}`;
}

function SettingsForm({ league, canEdit }: { league: LeagueResponse; canEdit: boolean }) {
  const updateLeague = useUpdateLeagueMutation(league.id);

  // Stated deviation from the TanStack-Form rule (mirrors new.tsx): the whole
  // merged form — name included — is plain useState. Mixing TanStack Form's
  // field API for just the name with controlled state for visibility /
  // maxMembers / mode settings would fragment dirty-tracking and the single
  // Save button across two paradigms; every field here is re-validated as one
  // assembled object at save time regardless.
  const [name, setName] = useState(league.name);
  const [visibility, setVisibility] = useState<LeagueVisibility>(league.visibility);
  const [maxMembers, setMaxMembers] = useState(league.maxMembers);

  const isPickem = league.mode === LEAGUE_MODE.PICKEM;
  const isElimination = league.mode === LEAGUE_MODE.ELIMINATION;
  const isMarchMadness = league.mode === LEAGUE_MODE.MARCH_MADNESS;

  // All three modes' fields are declared unconditionally (only the active
  // mode's fieldset renders) — a league's mode never changes post-create, but
  // branching the hooks themselves on it would violate rules-of-hooks.
  const [pickemStartWeek, setPickemStartWeek] = useState(
    isPickem
      ? encodeWeek((league.settings as PickemSettings).startWeek)
      : DEFAULT_PICKEM_START_WEEK,
  );
  const [pickemEndWeek, setPickemEndWeek] = useState(
    isPickem ? encodeWeek((league.settings as PickemSettings).endWeek) : DEFAULT_PICKEM_END_WEEK,
  );
  const [pickemPickType, setPickemPickType] = useState<PickType>(
    isPickem ? (league.settings as PickemSettings).pickType : PICK_TYPE.STRAIGHT_UP,
  );
  const [pickemPicksPerWeek, setPickemPicksPerWeek] = useState(
    isPickem ? (league.settings as PickemSettings).picksPerWeek : 5,
  );
  const [pickemPushTie, setPickemPushTie] = useState<PickemPushTieResolution>(
    isPickem
      ? ((league.settings as PickemSettings).pushTieResolution ??
          PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT)
      : PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT,
  );

  const [eliminationStartWeek, setEliminationStartWeek] = useState(
    isElimination
      ? encodeWeek((league.settings as EliminationSettings).startWeek)
      : DEFAULT_PICKEM_START_WEEK,
  );
  const [eliminationEndWeek, setEliminationEndWeek] = useState(
    isElimination
      ? encodeWeek((league.settings as EliminationSettings).endWeek)
      : DEFAULT_PICKEM_END_WEEK,
  );
  const [eliminationPickType, setEliminationPickType] = useState<PickType>(
    isElimination ? (league.settings as EliminationSettings).pickType : PICK_TYPE.STRAIGHT_UP,
  );
  const [eliminationPushTie, setEliminationPushTie] = useState<EliminationPushTieResolution>(
    isElimination
      ? ((league.settings as EliminationSettings).pushTieResolution ??
          ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE)
      : ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE,
  );

  const initialMarchMadness = isMarchMadness ? (league.settings as MarchMadnessSettings) : null;
  const [mmMaxBrackets, setMmMaxBrackets] = useState(
    initialMarchMadness?.maxBracketsPerMember ?? 5,
  );
  const [mmScoringModel, setMmScoringModel] = useState<MarchMadnessScoringModel>(
    initialMarchMadness?.scoringModel ?? MARCH_MADNESS_SCORING_MODEL.STANDARD_DOUBLING,
  );
  const [mmRoundValues, setMmRoundValues] = useState<number[]>(
    initialMarchMadness?.scoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM
      ? initialMarchMadness.roundValues
      : [0, 0, 0, 0, 0, 0],
  );

  const nameParsed = LeagueNameSchema.safeParse(name);
  const nameDirty = name.trim() !== league.name;
  const visibilityDirty = visibility !== league.visibility;
  const maxMembersDirty = maxMembers !== league.maxMembers;

  // Settings are all-or-nothing: any changed field in the active mode's
  // fieldset re-assembles and re-validates the whole settings object (the
  // server stores + reads settings as one JSONB blob per mode).
  let settingsDirty: boolean;
  let assembledSettings: unknown;
  if (isPickem) {
    const existing = league.settings as PickemSettings;
    assembledSettings = {
      startWeek: decodeWeek(pickemStartWeek),
      endWeek: decodeWeek(pickemEndWeek),
      pickType: pickemPickType,
      picksPerWeek: pickemPicksPerWeek,
      pushTieResolution: pickemPushTie,
    };
    settingsDirty =
      pickemStartWeek !== encodeWeek(existing.startWeek) ||
      pickemEndWeek !== encodeWeek(existing.endWeek) ||
      pickemPickType !== existing.pickType ||
      pickemPicksPerWeek !== existing.picksPerWeek ||
      pickemPushTie !== (existing.pushTieResolution ?? PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT);
  } else if (isElimination) {
    const existing = league.settings as EliminationSettings;
    assembledSettings = {
      startWeek: decodeWeek(eliminationStartWeek),
      endWeek: decodeWeek(eliminationEndWeek),
      pickType: eliminationPickType,
      pushTieResolution: eliminationPushTie,
    };
    settingsDirty =
      eliminationStartWeek !== encodeWeek(existing.startWeek) ||
      eliminationEndWeek !== encodeWeek(existing.endWeek) ||
      eliminationPickType !== existing.pickType ||
      eliminationPushTie !==
        (existing.pushTieResolution ?? ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE);
  } else {
    const existing = league.settings as MarchMadnessSettings;
    assembledSettings =
      mmScoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM
        ? {
            maxBracketsPerMember: mmMaxBrackets,
            scoringModel: mmScoringModel,
            roundValues: mmRoundValues,
          }
        : { maxBracketsPerMember: mmMaxBrackets, scoringModel: mmScoringModel };
    settingsDirty =
      mmMaxBrackets !== existing.maxBracketsPerMember ||
      mmScoringModel !== existing.scoringModel ||
      (mmScoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM &&
        existing.scoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM &&
        JSON.stringify(mmRoundValues) !== JSON.stringify(existing.roundValues));
  }

  const hasInvalidNumberField =
    numberFieldInvalid(maxMembers, 2, MAX_LEAGUE_SIZE) ||
    (isPickem && numberFieldInvalid(pickemPicksPerWeek, 1, 16)) ||
    (isMarchMadness &&
      (numberFieldInvalid(mmMaxBrackets, 1, 10) ||
        (mmScoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM &&
          mmRoundValues.some((roundValue) => numberFieldInvalid(roundValue, 0)))));

  const anyDirty = nameDirty || visibilityDirty || maxMembersDirty || settingsDirty;
  const canSave =
    canEdit && anyDirty && nameParsed.success && !hasInvalidNumberField && !updateLeague.isPending;

  const handleSave = () => {
    if (!nameParsed.success) {
      toast.error(nameParsed.error.issues[0]?.message ?? "Check the league name.");
      return;
    }
    const body: UpdateLeagueRequest = {};
    if (nameDirty) body.name = nameParsed.data;
    if (visibilityDirty) body.visibility = visibility;
    if (maxMembersDirty) body.maxMembers = maxMembers;
    if (settingsDirty) {
      const parsedSettings = LEAGUE_SETTINGS_SCHEMAS[league.mode].safeParse(assembledSettings);
      if (!parsedSettings.success) {
        toast.error(parsedSettings.error.issues[0]?.message ?? "Check your league settings.");
        return;
      }
      body.settings = parsedSettings.data;
    }
    updateLeague.mutate(body);
  };

  return (
    <>
      {/* Field.Root cascades `disabled` to every descendant Base UI control
          (Input, Select, Radio) through context — including the ones nested
          inside the shared per-mode fieldsets (league-settings-fields.tsx) —
          without those components needing to forward a `disabled` prop
          themselves. That's the read-only gate for non-editors (item 4). */}
      <Field.Root disabled={!canEdit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="league-name">League name</Label>
          <Input
            id="league-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={!nameParsed.success ? true : undefined}
            aria-describedby={!nameParsed.success ? "league-name-error" : undefined}
          />
          {!nameParsed.success && (
            <p id="league-name-error" className="text-sm text-destructive">
              {nameParsed.error.issues[0]?.message}
            </p>
          )}
        </div>

        <RadioField
          legend="Visibility"
          name="league-visibility"
          value={visibility}
          onValueChange={setVisibility}
          options={VISIBILITY_OPTIONS}
        />

        <NumberField
          id="league-max-members"
          label="Max members"
          description="Anywhere from 2 to 100 members."
          min={2}
          max={MAX_LEAGUE_SIZE}
          value={maxMembers}
          onValueChange={setMaxMembers}
        />

        {isPickem && (
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

        {isElimination && (
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

        {isMarchMadness && (
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
      </Field.Root>

      {canEdit && (
        <>
          {/* Static copy, not a client-computed "now" gate — the server's 409
              (league_started) is the real lock; this just sets expectations.
              Editors only: read-only viewers can't act on it. */}
          <p className="text-sm text-muted-foreground">
            Visibility, max members, and game settings lock once the league starts. League name can
            be changed anytime.
          </p>
          <Button size="sm" className="self-start" disabled={!canSave} onClick={handleSave}>
            Save changes
          </Button>
        </>
      )}
    </>
  );
}
