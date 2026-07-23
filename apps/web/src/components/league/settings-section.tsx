import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  MARCH_MADNESS_SCORING_MODEL,
  MAX_LEAGUE_SIZE,
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
} from "@picksleagues/schemas";
import {
  EliminationSettingsFields,
  MarchMadnessSettingsFields,
  PickemSettingsFields,
  RadioField,
  VISIBILITY_OPTIONS,
  decodeWeek,
  encodeWeek,
} from "@/components/league-settings-fields";
import { FormTextField } from "@/components/form-field";
import { NumberField, numberFieldInvalid } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useUpdateLeagueMutation } from "@/components/league/use-update-league";

export function LeagueSettingsSection({ league }: { league: LeagueResponse }) {
  const leagueId = league.id;

  const renameMutation = useUpdateLeagueMutation(leagueId);
  const visibilityMutation = useUpdateLeagueMutation(leagueId);
  const maxMembersMutation = useUpdateLeagueMutation(leagueId);
  const settingsMutation = useUpdateLeagueMutation(leagueId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>League settings</CardTitle>
        {/* Edit controls always render for commissioners; a post-start edit
            is refused via the server's 409 (league_started) rather than a
            client-computed "now" gate — lock state is derived, never
            stored, and every mutation re-validates server-side (arch D11). */}
        <CardDescription>Visibility and mode settings lock once the league starts.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <RenameForm
          key={league.name}
          league={league}
          onSave={(name) => renameMutation.mutate({ name })}
          isPending={renameMutation.isPending}
        />
        <VisibilitySection
          key={league.visibility}
          league={league}
          onSave={(visibility) => visibilityMutation.mutate({ visibility })}
          isPending={visibilityMutation.isPending}
        />
        <MaxMembersSection
          key={league.maxMembers}
          league={league}
          onSave={(maxMembers) => maxMembersMutation.mutate({ maxMembers })}
          isPending={maxMembersMutation.isPending}
        />
        <SettingsFieldsSection
          league={league}
          onSave={(settings) => settingsMutation.mutate({ settings })}
          isPending={settingsMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}

function RenameForm({
  league,
  onSave,
  isPending,
}: {
  league: LeagueResponse;
  onSave: (name: string) => void;
  isPending: boolean;
}) {
  const form = useForm({
    defaultValues: { name: league.name },
    onSubmit: async ({ value }) => {
      const name = LeagueNameSchema.parse(value.name);
      if (name === league.name) return;
      onSave(name);
    },
  });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      noValidate
    >
      <h3 className="text-sm font-semibold text-foreground">League name</h3>
      <form.Field name="name" validators={{ onSubmit: LeagueNameSchema }}>
        {(field) => <FormTextField field={field} label="Name" />}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.name}>
        {(name) => (
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={name.trim() === league.name || isPending}
          >
            Save name
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

function VisibilitySection({
  league,
  onSave,
  isPending,
}: {
  league: LeagueResponse;
  onSave: (visibility: LeagueVisibility) => void;
  isPending: boolean;
}) {
  const [visibility, setVisibility] = useState<LeagueVisibility>(league.visibility);

  return (
    <div className="flex flex-col gap-2">
      <RadioField
        legend="Visibility"
        name="league-visibility"
        value={visibility}
        onValueChange={setVisibility}
        options={VISIBILITY_OPTIONS}
      />
      <Button
        size="sm"
        className="self-start"
        disabled={visibility === league.visibility || isPending}
        onClick={() => onSave(visibility)}
      >
        Save visibility
      </Button>
    </div>
  );
}

function MaxMembersSection({
  league,
  onSave,
  isPending,
}: {
  league: LeagueResponse;
  onSave: (maxMembers: number) => void;
  isPending: boolean;
}) {
  const [maxMembers, setMaxMembers] = useState(league.maxMembers);

  return (
    <div className="flex flex-col gap-2">
      <NumberField
        id="league-max-members"
        label="Max members"
        min={2}
        max={MAX_LEAGUE_SIZE}
        value={maxMembers}
        onValueChange={setMaxMembers}
      />
      <Button
        size="sm"
        className="self-start"
        disabled={
          maxMembers === league.maxMembers ||
          numberFieldInvalid(maxMembers, 2, MAX_LEAGUE_SIZE) ||
          isPending
        }
        onClick={() => onSave(maxMembers)}
      >
        Save max members
      </Button>
    </div>
  );
}

function SettingsFieldsSection({
  league,
  onSave,
  isPending,
}: {
  league: LeagueResponse;
  onSave: (settings: unknown) => void;
  isPending: boolean;
}) {
  if (league.mode === LEAGUE_MODE.PICKEM) {
    return (
      <PickemSettingsEditor
        settings={league.settings as PickemSettings}
        onSave={onSave}
        isPending={isPending}
      />
    );
  }
  if (league.mode === LEAGUE_MODE.ELIMINATION) {
    return (
      <EliminationSettingsEditor
        settings={league.settings as EliminationSettings}
        onSave={onSave}
        isPending={isPending}
      />
    );
  }
  return (
    <MarchMadnessSettingsEditor
      settings={league.settings as MarchMadnessSettings}
      onSave={onSave}
      isPending={isPending}
    />
  );
}

// The three settings editors below share new.tsx's stated deviation from the
// TanStack-Form rule: select/radio/stepper state whose option sets are already
// schema-constrained, parsed as one object at submit (server re-validates).
function PickemSettingsEditor({
  settings,
  onSave,
  isPending,
}: {
  settings: PickemSettings;
  onSave: (settings: unknown) => void;
  isPending: boolean;
}) {
  const [startWeek, setStartWeek] = useState(encodeWeek(settings.startWeek));
  const [endWeek, setEndWeek] = useState(encodeWeek(settings.endWeek));
  const [pickType, setPickType] = useState<PickType>(settings.pickType);
  const [picksPerWeek, setPicksPerWeek] = useState(settings.picksPerWeek);
  const [pushTie, setPushTie] = useState<PickemPushTieResolution>(
    settings.pushTieResolution ?? PICKEM_PUSH_TIE_RESOLUTION.HALF_POINT,
  );

  return (
    <div className="flex flex-col gap-4">
      <PickemSettingsFields
        startWeek={startWeek}
        onStartWeekChange={setStartWeek}
        endWeek={endWeek}
        onEndWeekChange={setEndWeek}
        pickType={pickType}
        onPickTypeChange={setPickType}
        picksPerWeek={picksPerWeek}
        onPicksPerWeekChange={setPicksPerWeek}
        pushTie={pushTie}
        onPushTieChange={setPushTie}
      />
      <Button
        size="sm"
        className="self-start"
        disabled={isPending}
        onClick={() => {
          const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.PICKEM].safeParse({
            startWeek: decodeWeek(startWeek),
            endWeek: decodeWeek(endWeek),
            pickType,
            picksPerWeek,
            pushTieResolution: pushTie,
          });
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Check your league settings.");
            return;
          }
          onSave(parsed.data);
        }}
      >
        Save settings
      </Button>
    </div>
  );
}

function EliminationSettingsEditor({
  settings,
  onSave,
  isPending,
}: {
  settings: EliminationSettings;
  onSave: (settings: unknown) => void;
  isPending: boolean;
}) {
  const [startWeek, setStartWeek] = useState(encodeWeek(settings.startWeek));
  const [endWeek, setEndWeek] = useState(encodeWeek(settings.endWeek));
  const [pickType, setPickType] = useState<PickType>(settings.pickType);
  const [pushTie, setPushTie] = useState<EliminationPushTieResolution>(
    settings.pushTieResolution ?? ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE,
  );

  return (
    <div className="flex flex-col gap-4">
      <EliminationSettingsFields
        startWeek={startWeek}
        onStartWeekChange={setStartWeek}
        endWeek={endWeek}
        onEndWeekChange={setEndWeek}
        pickType={pickType}
        onPickTypeChange={setPickType}
        pushTie={pushTie}
        onPushTieChange={setPushTie}
      />
      <Button
        size="sm"
        className="self-start"
        disabled={isPending}
        onClick={() => {
          const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.ELIMINATION].safeParse({
            startWeek: decodeWeek(startWeek),
            endWeek: decodeWeek(endWeek),
            pickType,
            pushTieResolution: pushTie,
          });
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Check your league settings.");
            return;
          }
          onSave(parsed.data);
        }}
      >
        Save settings
      </Button>
    </div>
  );
}

function MarchMadnessSettingsEditor({
  settings,
  onSave,
  isPending,
}: {
  settings: MarchMadnessSettings;
  onSave: (settings: unknown) => void;
  isPending: boolean;
}) {
  const [maxBrackets, setMaxBrackets] = useState(settings.maxBracketsPerMember);
  const [scoringModel, setScoringModel] = useState<MarchMadnessScoringModel>(settings.scoringModel);
  const [roundValues, setRoundValues] = useState<number[]>(
    settings.scoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM
      ? settings.roundValues
      : [0, 0, 0, 0, 0, 0],
  );

  return (
    <div className="flex flex-col gap-4">
      <MarchMadnessSettingsFields
        maxBrackets={maxBrackets}
        onMaxBracketsChange={setMaxBrackets}
        scoringModel={scoringModel}
        onScoringModelChange={setScoringModel}
        roundValues={roundValues}
        onRoundValueChange={(index, next) =>
          setRoundValues((prev) => prev.map((value, i) => (i === index ? next : value)))
        }
      />
      <Button
        size="sm"
        className="self-start"
        disabled={isPending}
        onClick={() => {
          const assembled =
            scoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM
              ? { maxBracketsPerMember: maxBrackets, scoringModel, roundValues }
              : { maxBracketsPerMember: maxBrackets, scoringModel };
          const parsed = LEAGUE_SETTINGS_SCHEMAS[LEAGUE_MODE.MARCH_MADNESS].safeParse(assembled);
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Check your league settings.");
            return;
          }
          onSave(parsed.data);
        }}
      >
        Save settings
      </Button>
    </div>
  );
}
