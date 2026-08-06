import { useState } from "react";
import { Field } from "@base-ui/react/field";
import { toast } from "sonner";
import {
  ELIMINATION_PUSH_TIE_RESOLUTION,
  LEAGUE_MODE,
  LEAGUE_SETTINGS_INPUT_SCHEMAS,
  MARCH_MADNESS_SCORING_MODEL,
  MAX_LEAGUE_SIZE,
  PICK_TYPE,
  PICKEM_NOMINAL_RANGE,
  LeagueNameSchema,
  pickemSettingsInvalidatePicks,
  type EliminationPushTieResolution,
  type LeagueResponse,
  type LeagueVisibility,
  type MarchMadnessScoringModel,
  type PickType,
  type PickemSeasonRangePreset,
  type PickemSettings,
  type PickemSettingsInput,
  type UpdateLeagueRequest,
} from "@picksleagues/schemas";
import {
  DEFAULT_ELIMINATION_END_WEEK,
  DEFAULT_ELIMINATION_START_WEEK,
  DEFAULT_PICKEM_SEASON_RANGE,
  EliminationSettingsFields,
  MarchMadnessSettingsFields,
  PickemSettingsFields,
  RadioField,
  VISIBILITY_OPTIONS,
  decodeWeek,
  encodeWeek,
} from "@/components/league-settings-fields";
import { NumberField, numberFieldInvalid } from "@/components/number-field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateLeague } from "@/api/leagues";
import { usePickemPickSummary } from "@/api/pickem";
import {
  eliminationSettingsOf,
  marchMadnessSettingsOf,
  pickemSettingsOf,
} from "@/lib/league-settings";
import { useErrorToast } from "@/lib/use-error-toast";

export function LeagueSettingsSection({
  league,
  canEdit,
  started,
}: {
  league: LeagueResponse;
  canEdit: boolean;
  started: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>League settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Forces a remount (and a fresh derived-state read) whenever any
            editable field changes on the server — the successful-save
            invalidation in api/leagues.ts's useUpdateLeague refetches
            `league`, and this key re-derives every field from it rather than
            syncing each one via a `useEffect` (the effect-free idiom
            number-field.tsx uses for a single prop, applied once for the
            whole merged form). */}
        <SettingsForm
          key={settingsFingerprint(league)}
          league={league}
          canEdit={canEdit}
          started={started}
        />
      </CardContent>
    </Card>
  );
}

function settingsFingerprint(league: LeagueResponse): string {
  return `${league.name}|${league.visibility}|${league.maxMembers}|${JSON.stringify(league.settings)}`;
}

function SettingsForm({
  league,
  canEdit,
  started,
}: {
  league: LeagueResponse;
  canEdit: boolean;
  started: boolean;
}) {
  const updateLeague = useUpdateLeague(league.id);

  // The forms rule's per-mode carve-out (engineering rules §Quality), which
  // this and `leagues/new.tsx` are the whole of: the merged form — name
  // included — is plain useState, because splitting it between TanStack Form's
  // field API for the mode-agnostic inputs and controlled state for the
  // per-mode fieldsets would fragment dirty-tracking and the single Save across
  // two paradigms. Every field is re-validated as one assembled object at save
  // time regardless.
  const [name, setName] = useState(league.name);
  const [visibility, setVisibility] = useState<LeagueVisibility>(league.visibility);
  const [maxMembers, setMaxMembers] = useState(league.maxMembers);

  const isPickem = league.mode === LEAGUE_MODE.PICKEM;
  const isElimination = league.mode === LEAGUE_MODE.ELIMINATION;
  const isMarchMadness = league.mode === LEAGUE_MODE.MARCH_MADNESS;

  // Parsed once, and used for all three jobs below — seeding the controls,
  // deciding what counts as dirty, and deciding whether a save would strand
  // picks. Casting instead would let those three read `undefined` for a field
  // a stored blob predates while the server's own parse reads a real default
  // (see pickemSettingsOf), and the dirty check would then have to restate
  // every `.default()` by hand to compensate — which is exactly how a client
  // comes to believe a pick-destroying change is harmless.
  //
  // `null` means "not this mode, or the stored blob doesn't parse". The second
  // can't happen for a blob the server itself wrote, but it fails safe
  // everywhere it's consulted: controls seed from the create-form defaults, the
  // fieldset reads as dirty so the commissioner can save a correction, and
  // `wouldInvalidatePicks` assumes the worst.
  const pickemSettings = pickemSettingsOf(league);
  const eliminationSettings = eliminationSettingsOf(league);
  const marchMadnessSettings = marchMadnessSettingsOf(league);

  // Fetched only for a Pick'em editor — an ordinary member has no use for it
  // (403 otherwise), and the two other modes have no pick-invalidation rule
  // yet (ELM-2 will add its own). Feeds the pre-save warning/confirm below.
  // Post-start, the visibility/max-members/mode fieldset is locked (Decision
  // 3), so the invalidation warning it feeds can no longer fire — no point
  // fetching the count.
  const pickSummary = usePickemPickSummary(league.id, isPickem && canEdit && !started);

  // All three modes' fields are declared unconditionally (only the active
  // mode's fieldset renders) — a league's mode never changes post-create, but
  // branching the hooks themselves on it would violate rules-of-hooks.
  const [pickemSeasonRange, setPickemSeasonRange] = useState<PickemSeasonRangePreset>(
    pickemSettings?.seasonRangePreset ?? DEFAULT_PICKEM_SEASON_RANGE,
  );
  const [pickemPickType, setPickemPickType] = useState<PickType>(
    pickemSettings?.pickType ?? PICK_TYPE.STRAIGHT_UP,
  );
  const [pickemPicksPerWeek, setPickemPicksPerWeek] = useState(pickemSettings?.picksPerWeek ?? 5);

  const [eliminationStartWeek, setEliminationStartWeek] = useState(
    eliminationSettings
      ? encodeWeek(eliminationSettings.startWeek)
      : DEFAULT_ELIMINATION_START_WEEK,
  );
  const [eliminationEndWeek, setEliminationEndWeek] = useState(
    eliminationSettings ? encodeWeek(eliminationSettings.endWeek) : DEFAULT_ELIMINATION_END_WEEK,
  );
  const [eliminationPickType, setEliminationPickType] = useState<PickType>(
    eliminationSettings?.pickType ?? PICK_TYPE.STRAIGHT_UP,
  );
  const [eliminationPushTie, setEliminationPushTie] = useState<EliminationPushTieResolution>(
    eliminationSettings?.pushTieResolution ?? ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE,
  );

  const [mmMaxBrackets, setMmMaxBrackets] = useState(
    marchMadnessSettings?.maxBracketsPerMember ?? 5,
  );
  const [mmScoringModel, setMmScoringModel] = useState<MarchMadnessScoringModel>(
    marchMadnessSettings?.scoringModel ?? MARCH_MADNESS_SCORING_MODEL.STANDARD_DOUBLING,
  );
  const [mmRoundValues, setMmRoundValues] = useState<number[]>(
    marchMadnessSettings?.scoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM
      ? marchMadnessSettings.roundValues
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
  // Whether the assembled draft would invalidate already-submitted picks
  // (spec §Commissioner Powers), via the same predicate the server's
  // settings write clears picks with — computed here so the warning/confirm
  // below can never disagree with what a save would actually destroy.
  // Elimination has no picks yet (ELM-2), so it's Pick'em-only.
  //
  // Advisory only, not authoritative: this compares the draft against the
  // *cached* `league.settings` the editor was opened with, while the
  // server's write compares against the row it reads inside its own
  // transaction (resetPicksInvalidatedBySettings). Two commissioners editing
  // concurrently could see this disagree with what the server actually does
  // — that's fine, because the server's decision is safe either way (it
  // clears exactly what it decides to clear, or 409s on a locked pick); this
  // value only ever governs whether the client shows a warning first.
  let wouldInvalidatePicks = false;
  if (isPickem) {
    // The draft's range is the *chosen preset's nominal* range, never the
    // stored refs: a save re-resolves the preset server-side (ADR-0020), so
    // carrying the stored refs through would answer "nothing strands" while the
    // server narrows the range and clears every pick — the exact silent
    // destructive save this warning exists to prevent.
    //
    // Nominal is exact here, not an approximation, because settings only edit
    // pre-start: the stored start week's first kickoff is by definition still
    // ahead, so the server's resolved start can only be the stored start or the
    // nominal one, never some week in between that this would miss.
    const nominal = PICKEM_NOMINAL_RANGE[pickemSeasonRange];
    const draft: PickemSettings = {
      seasonRangePreset: pickemSeasonRange,
      startWeek: nominal.startWeek,
      endWeek: nominal.endWeek,
      pickType: pickemPickType,
      picksPerWeek: pickemPicksPerWeek,
    };
    // What actually goes on the wire carries no week refs (ADR-0020 §The wire
    // shape diverges from the stored shape) — the draft's refs exist only to
    // ask the invalidation question above.
    assembledSettings = {
      seasonRangePreset: pickemSeasonRange,
      pickType: pickemPickType,
      picksPerWeek: pickemPicksPerWeek,
    } satisfies PickemSettingsInput;
    // Both sides of every comparison below come from the same parse the server
    // compares against (services/pickem/settings-reset.ts), so a `.default()`
    // is materialized identically here and there — no `??` fallback restating
    // one, which is what would silently drift the day a default changes.
    settingsDirty = pickemSettings
      ? pickemSeasonRange !== pickemSettings.seasonRangePreset ||
        pickemPickType !== pickemSettings.pickType ||
        pickemPicksPerWeek !== pickemSettings.picksPerWeek
      : true;
    wouldInvalidatePicks = pickemSettings
      ? pickemSettingsInvalidatePicks(pickemSettings, draft)
      : true;
  } else if (isElimination) {
    assembledSettings = {
      startWeek: decodeWeek(eliminationStartWeek),
      endWeek: decodeWeek(eliminationEndWeek),
      pickType: eliminationPickType,
      pushTieResolution: eliminationPushTie,
    };
    settingsDirty = eliminationSettings
      ? eliminationStartWeek !== encodeWeek(eliminationSettings.startWeek) ||
        eliminationEndWeek !== encodeWeek(eliminationSettings.endWeek) ||
        eliminationPickType !== eliminationSettings.pickType ||
        eliminationPushTie !== eliminationSettings.pushTieResolution
      : true;
  } else {
    assembledSettings =
      mmScoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM
        ? {
            maxBracketsPerMember: mmMaxBrackets,
            scoringModel: mmScoringModel,
            roundValues: mmRoundValues,
          }
        : { maxBracketsPerMember: mmMaxBrackets, scoringModel: mmScoringModel };
    settingsDirty = marchMadnessSettings
      ? mmMaxBrackets !== marchMadnessSettings.maxBracketsPerMember ||
        mmScoringModel !== marchMadnessSettings.scoringModel ||
        (mmScoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM &&
          marchMadnessSettings.scoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM &&
          JSON.stringify(mmRoundValues) !== JSON.stringify(marchMadnessSettings.roundValues))
      : true;
  }

  // Every other failed query in this codebase surfaces via the shared toast —
  // this one silently disabled the whole pre-save warning before it was
  // handled. Gated on `wouldInvalidatePicks` rather than the bare error: the
  // summary is only consulted for a change that would destroy picks, so a
  // commissioner editing the league name while this endpoint is down has
  // nothing to be told about.
  useErrorToast(
    wouldInvalidatePicks && pickSummary.isError,
    "Couldn't check how many picks this change would delete — please try again.",
  );

  const hasInvalidNumberField =
    numberFieldInvalid(maxMembers, 2, MAX_LEAGUE_SIZE) ||
    (isPickem && numberFieldInvalid(pickemPicksPerWeek, 1, 16)) ||
    (isMarchMadness &&
      (numberFieldInvalid(mmMaxBrackets, 1, 10) ||
        (mmScoringModel === MARCH_MADNESS_SCORING_MODEL.CUSTOM &&
          mmRoundValues.some((roundValue) => numberFieldInvalid(roundValue, 0)))));

  // Once started, only the name axis is still editable (Decision 3) — a
  // dirty lockable field left over from the same minute the window closed
  // must not count toward "there's something to save".
  const anyDirty = started
    ? nameDirty
    : nameDirty || visibilityDirty || maxMembersDirty || settingsDirty;
  const pickCount = pickSummary.data?.pickCount ?? 0;
  const memberCount = pickSummary.data?.memberCount ?? 0;

  // The pick-summary query's three states, named explicitly rather than
  // derived from `isLoading` (TanStack Query v5: `isLoading === isPending &&
  // isFetching`, which goes false once retries exhaust into `status:
  // "error"`) — collapsing "errored" into "not loading" is exactly how the
  // whole warning went silently unreachable from one transient 500. Keeping
  // all three spelled out means a future edit can't re-collapse them.
  //
  // - pending: the count hasn't arrived yet. While a change that WOULD
  //   invalidate is pending its real count, Save stays disabled rather than
  //   risk skipping the confirm because the count hasn't arrived yet — the
  //   summary query starts as soon as this editor is commissioner-visible,
  //   so this window is normally sub-second.
  const pickSummaryPending = isPickem && wouldInvalidatePicks && pickSummary.isPending;
  // - errored: the count is UNKNOWN, not zero. Treating an unreachable
  //   summary as "no picks at risk" is the defect this replaced — it let a
  //   commissioner save a pick-destroying change with no warning and no
  //   confirm. So an error is always treated as "picks might exist", and
  //   Save must stay enabled (a genuinely harmless change must still be
  //   saveable even if this side query is down).
  const pickSummaryUnknown = isPickem && wouldInvalidatePicks && pickSummary.isError;
  // - loaded: a real, nonzero count — never a fired-when-nothing's-at-stake
  //   dialog (a warning that fires with nothing to lose trains people to
  //   click through it).
  const pickWarningActive = wouldInvalidatePicks && (pickSummaryUnknown || pickCount > 0);
  // Once started, the lockable fields' validity and the pick-invalidation
  // check are moot — only the name axis can still be saved (Decision 3), so
  // neither `hasInvalidNumberField` (a locked field's own stale value) nor
  // `pickSummaryPending` (a query that no longer even fetches, see above) may
  // gate it.
  const canSave = started
    ? canEdit && anyDirty && nameParsed.success && !updateLeague.isPending
    : canEdit &&
      anyDirty &&
      nameParsed.success &&
      !hasInvalidNumberField &&
      !updateLeague.isPending &&
      !pickSummaryPending;

  const handleSave = () => {
    if (!nameParsed.success) {
      toast.error(nameParsed.error.issues[0]?.message ?? "Check the league name.");
      return;
    }
    const body: UpdateLeagueRequest = {};
    if (nameDirty) body.name = nameParsed.data;
    // The lockable fields are disabled post-start, but state dirtied in the
    // minute before `useAppNow()` ticked past the start survives the tick —
    // and the server 409s the whole PATCH on any pre-start-only field, taking
    // the still-legal name change down with it. `anyDirty` already ignores
    // them; the payload has to as well.
    if (!started) {
      if (visibilityDirty) body.visibility = visibility;
      if (maxMembersDirty) body.maxMembers = maxMembers;
      if (settingsDirty) {
        // The *input* map, not the stored one: Pick'em's request shape is the
        // preset without the week refs the server resolves (ADR-0020), and the
        // two other modes map to the same schema in both.
        const parsedSettings =
          LEAGUE_SETTINGS_INPUT_SCHEMAS[league.mode].safeParse(assembledSettings);
        if (!parsedSettings.success) {
          toast.error(parsedSettings.error.issues[0]?.message ?? "Check your league settings.");
          return;
        }
        body.settings = parsedSettings.data;
      }
    }
    updateLeague.mutate(body);
  };

  return (
    <>
      {/* Field.Root cascades `disabled` to every descendant Base UI control
          (Input, Select, Radio) through context — including the ones nested
          inside the shared per-mode fieldsets (league-settings-fields.tsx) —
          without those components needing to forward a `disabled` prop
          themselves. That's the read-only gate for non-editors (item 4). Name
          gets its own root because EDIT_NAME has no window (Decision 3): a
          commissioner keeps it editable after the league starts even though
          the group below locks. */}
      <Field.Root disabled={!canEdit} className="flex flex-col gap-1.5">
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
      </Field.Root>

      <Field.Root disabled={!canEdit || started} className="flex flex-col gap-6">
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
            seasonRange={pickemSeasonRange}
            onSeasonRangeChange={setPickemSeasonRange}
            pickType={pickemPickType}
            onPickTypeChange={setPickemPickType}
            picksPerWeek={pickemPicksPerWeek}
            onPicksPerWeekChange={setPickemPicksPerWeek}
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
          {/* Not a client-computed lock — the server's 409 (league_started)
              is the real enforcement; this is the disable-with-reason hint
              (Decision 1/3), derived from the same `started` the Field.Root
              above disables on. Editors only: read-only viewers can't act on
              it. */}
          <p className="text-sm text-muted-foreground">
            {started
              ? "Visibility, max members, and game settings are locked — the league has started. League name can still be changed."
              : "Visibility, max members, and game settings lock once the league starts. League name can be changed anytime."}
          </p>

          {/* Only rendered with a real, nonzero count OR an unknown one
              (engineering rules §UI: no arbitrary color — destructive is a
              theme token) — a warning that could fire with nothing at stake
              would train commissioners to click through it, but an unknown
              count must still warn (fail safe, see pickSummaryUnknown above). */}
          {pickWarningActive && (
            <p className="text-sm text-destructive">
              {pickSummaryUnknown
                ? "Saving will permanently delete every pick already submitted — we couldn't check how many, but this can't be undone."
                : `Saving will permanently delete ${pickCount} ${pickCount === 1 ? "pick" : "picks"} from ${memberCount} ${memberCount === 1 ? "member" : "members"} — this can't be undone.`}
            </p>
          )}

          {pickWarningActive ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button size="sm" className="self-start" disabled={!canSave} />}
              >
                Save changes
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {pickSummaryUnknown
                      ? "Delete every submitted pick?"
                      : `Delete ${pickCount} ${pickCount === 1 ? "pick" : "picks"}?`}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {pickSummaryUnknown
                      ? "This change clears every pick already submitted on this league — we couldn't check how many. This can't be undone."
                      : `This change clears ${pickCount} ${pickCount === 1 ? "pick" : "picks"} from ${memberCount} ${memberCount === 1 ? "member" : "members"}. This can't be undone.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={updateLeague.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={updateLeague.isPending}
                    onClick={handleSave}
                  >
                    Save changes
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button size="sm" className="self-start" disabled={!canSave} onClick={handleSave}>
              Save changes
            </Button>
          )}
        </>
      )}
    </>
  );
}
