import { useState } from "react";
import { Field } from "@base-ui/react/field";
import { toast } from "sonner";
import {
  LEAGUE_MODE,
  LEAGUE_SETTINGS_INPUT_SCHEMAS,
  MAX_LEAGUE_SIZE,
  PICK_TYPE,
  LeagueNameSchema,
  pickemSettingsInvalidatePicks,
  type LeagueResponse,
  type LeagueVisibility,
  type PickType,
  type PickemSettings,
  type PickemSettingsInput,
  type SurvivorSettingsInput,
  type UpdateLeagueRequest,
} from "@picksleagues/schemas";
import {
  SurvivorSettingsFields,
  MarchMadnessSettingsFields,
  PickemSettingsFields,
  RadioField,
  VISIBILITY_OPTIONS,
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
import { Section } from "@/components/section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateLeague } from "@/api/leagues";
import { usePickemPickSummary } from "@/api/pickem";
import {
  survivorSettingsOf,
  marchMadnessSettingsOf,
  pickemSettingsOf,
} from "@/lib/league-settings";
import { useErrorToast } from "@/lib/use-error-toast";

/**
 * The commissioner's settings editor. The route renders it on the role axis
 * alone — members get `LeagueSettingsSummary` instead — so nothing in here
 * gates on who is looking; `started` is the only remaining axis (which fields
 * are still open).
 */
export function LeagueSettingsSection({
  league,
  started,
}: {
  league: LeagueResponse;
  started: boolean;
}) {
  return (
    <Section title="League settings" className="gap-6">
      {/* Forces a remount (and a fresh derived-state read) whenever any
            editable field changes on the server — the successful-save
            invalidation in api/leagues.ts's useUpdateLeague refetches
            `league`, and this key re-derives every field from it rather than
            syncing each one via a `useEffect` (the effect-free idiom
            number-field.tsx uses for a single prop, applied once for the
            whole merged form). */}
      <SettingsForm key={settingsFingerprint(league)} league={league} started={started} />
    </Section>
  );
}

function settingsFingerprint(league: LeagueResponse): string {
  return `${league.name}|${league.visibility}|${league.maxMembers}|${JSON.stringify(league.settings)}`;
}

function SettingsForm({ league, started }: { league: LeagueResponse; started: boolean }) {
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
  const isSurvivor = league.mode === LEAGUE_MODE.SURVIVOR;
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
  const survivorSettings = survivorSettingsOf(league);
  const marchMadnessSettings = marchMadnessSettingsOf(league);

  // Fetched only for a Pick'em league (this form is commissioner-only by the
  // route's role branch, so the endpoint's 403 for ordinary members is
  // unreachable from here), and neither other mode has
  // a settings change this form can make that strands picks: March Madness
  // stores none, and Survivor's only invalidating change is a server-side
  // re-resolution of its start week, which no field here expresses (ADR-0026
  // removed the Pick Type that was the other one). Post-start the whole settings
  // fieldset is locked, so the warning this feeds can no longer fire — no point
  // fetching the count. The other two modes leave `wouldInvalidatePicks` false,
  // and nothing below reads this unless it's true.
  const pickSummary = usePickemPickSummary(league.id, isPickem && !started);

  // All three modes' fields are declared unconditionally (only the active
  // mode's fieldset renders) — a league's mode never changes post-create, but
  // branching the hooks themselves on it would violate rules-of-hooks.
  const [pickemPickType, setPickemPickType] = useState<PickType>(
    pickemSettings?.pickType ?? PICK_TYPE.STRAIGHT_UP,
  );
  const [pickemPicksPerWeek, setPickemPicksPerWeek] = useState(pickemSettings?.picksPerWeek ?? 5);

  const [mmMaxBrackets, setMmMaxBrackets] = useState(
    marchMadnessSettings?.maxBracketsPerMember ?? 5,
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
  // below can never disagree with what a save would actually destroy. Only
  // Pick'em can reach it from this form (ADR-0015 decision 3): March Madness
  // stores no picks, and Survivor's one invalidating change is decided by the
  // server's clock rather than by anything here.
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
    // The draft carries the *stored* refs unchanged: no field here moves the
    // range (ADR-0031 — the mode is regular-season only, and a save re-resolves
    // the refs server-side against the clock), so the range clauses of the
    // predicate are identity here and only the pick-rule clauses can fire. The
    // server-side start re-resolution this can't predict is the same
    // browser-can't-know caveat Survivor documents below.
    const draft: PickemSettings | null = pickemSettings
      ? {
          startWeek: pickemSettings.startWeek,
          endWeek: pickemSettings.endWeek,
          pickType: pickemPickType,
          picksPerWeek: pickemPicksPerWeek,
        }
      : null;
    // What actually goes on the wire carries no week refs (ADR-0031, matching
    // ADR-0024) — the draft's refs exist only to ask the invalidation question.
    assembledSettings = {
      pickType: pickemPickType,
      picksPerWeek: pickemPicksPerWeek,
    } satisfies PickemSettingsInput;
    // Both sides of every comparison below come from the same parse the server
    // compares against (services/pickem/settings-reset.ts), so a `.default()`
    // is materialized identically here and there — no `??` fallback restating
    // one, which is what would silently drift the day a default changes.
    settingsDirty = pickemSettings
      ? pickemPickType !== pickemSettings.pickType ||
        pickemPicksPerWeek !== pickemSettings.picksPerWeek
      : true;
    wouldInvalidatePicks =
      pickemSettings && draft ? pickemSettingsInvalidatePicks(pickemSettings, draft) : true;
  } else if (isSurvivor) {
    // A Survivor settings request is empty (ADR-0024/0026/0033) — nothing on
    // this form can express a Survivor rule, so the fieldset is never dirty
    // unless the stored blob failed to parse, in which case a save lets the
    // commissioner write a valid one back.
    assembledSettings = {} satisfies SurvivorSettingsInput;
    settingsDirty = survivorSettings ? false : true;
    // `wouldInvalidatePicks` stays false, and that is a statement about the
    // form rather than about the mode. Survivor's one invalidating change is an
    // advanced start week (`survivorSettingsInvalidatePicks`), and no field here
    // moves it: the server re-resolves the range against *its* clock, so
    // whether a save strands a pick is not something this browser can know
    // before asking. The server still clears (or 409s) correctly — this warning
    // was only ever advisory.
  } else {
    assembledSettings = { maxBracketsPerMember: mmMaxBrackets };
    settingsDirty = marchMadnessSettings
      ? mmMaxBrackets !== marchMadnessSettings.maxBracketsPerMember
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
    (isMarchMadness && numberFieldInvalid(mmMaxBrackets, 1, 10));

  // Once started, only the name axis is still editable — a
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
  const pickSummaryPending = wouldInvalidatePicks && pickSummary.isPending;
  // - errored: the count is UNKNOWN, not zero. Treating an unreachable
  //   summary as "no picks at risk" is the defect this replaced — it let a
  //   commissioner save a pick-destroying change with no warning and no
  //   confirm. So an error is always treated as "picks might exist", and
  //   Save must stay enabled (a genuinely harmless change must still be
  //   saveable even if this side query is down).
  const pickSummaryUnknown = wouldInvalidatePicks && pickSummary.isError;
  // - loaded: a real, nonzero count — never a fired-when-nothing's-at-stake
  //   dialog (a warning that fires with nothing to lose trains people to
  //   click through it).
  const pickWarningActive = wouldInvalidatePicks && (pickSummaryUnknown || pickCount > 0);
  // Once started, the lockable fields' validity and the pick-invalidation
  // check are moot — only the name axis can still be saved, so
  // neither `hasInvalidNumberField` (a locked field's own stale value) nor
  // `pickSummaryPending` (a query that no longer even fetches, see above) may
  // gate it.
  const canSave = started
    ? anyDirty && nameParsed.success && !updateLeague.isPending
    : anyDirty &&
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
        // The *input* map, not the stored one: both NFL modes' request shapes
        // omit the week refs the server resolves (ADR-0024/0031); March
        // Madness maps to the same schema in both.
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
      {/* Name sits outside the lockable Field.Root below because EDIT_NAME
          has no window: a commissioner keeps it editable after the league
          starts even though the group beneath locks. */}
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

      {/* Field.Root cascades `disabled` to every descendant Base UI control
          (Input, Select, Radio) through context — including the ones nested
          inside the shared per-mode fieldsets (league-settings-fields.tsx) —
          without those components needing to forward a `disabled` prop
          themselves. That's the post-start lock. */}
      <Field.Root disabled={started} className="flex flex-col gap-6">
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
            seasonRange={pickemSettings ?? undefined}
            pickType={pickemPickType}
            onPickTypeChange={setPickemPickType}
            picksPerWeek={pickemPicksPerWeek}
            onPicksPerWeekChange={setPickemPicksPerWeek}
          />
        )}

        {isSurvivor && <SurvivorSettingsFields seasonRange={survivorSettings ?? undefined} />}

        {isMarchMadness && (
          <MarchMadnessSettingsFields
            maxBrackets={mmMaxBrackets}
            onMaxBracketsChange={setMmMaxBrackets}
          />
        )}
      </Field.Root>

      {/* Not a client-computed lock — the server's 409 (league_started)
          is the real enforcement; this is the disable-with-reason hint
          derived from the same `started` the Field.Root above disables on. */}
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
  );
}
