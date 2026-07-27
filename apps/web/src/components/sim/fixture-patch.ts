import {
  UpdateSimFixtureGameRequestSchema,
  type SimFinalStatus,
  type SimFixtureGame,
  type UpdateSimFixtureGameRequest,
  type WeekType,
} from "@picksleagues/schemas";
import { toLocalDateTimeInputValue } from "@/lib/format";

/**
 * The fixture editor's string↔wire conversion, kept pure and out of the
 * component so the boundary that actually carries the bugs — empty string vs
 * null vs NaN, and which fields a save is allowed to touch — is unit-testable
 * without mounting a form. `FormTextField` always hands back
 * `event.target.value`, so every value here is a string even where the wire
 * type is a number.
 */
export type FixtureFormValues = {
  kickoffAt: string;
  weekType: WeekType;
  weekNumber: string;
  spread: string;
  finalStatus: SimFinalStatus;
  finalHomeScore: string;
  finalAwayScore: string;
};

export type FixtureFieldErrors = Partial<Record<keyof FixtureFormValues, string>>;

export type FixturePatchResult =
  | { status: "unchanged" }
  | { status: "invalid"; fieldErrors: FixtureFieldErrors }
  | { status: "ok"; patch: UpdateSimFixtureGameRequest };

export function fixtureFormSeed(game: SimFixtureGame): FixtureFormValues {
  return {
    kickoffAt: toLocalDateTimeInputValue(game.kickoffAt),
    weekType: game.weekType,
    weekNumber: String(game.weekNumber),
    spread: nullableToInput(game.spread),
    finalStatus: game.finalStatus,
    finalHomeScore: nullableToInput(game.finalHomeScore),
    finalAwayScore: nullableToInput(game.finalAwayScore),
  };
}

function nullableToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

// An empty field is an explicit `null` — the schema makes spread and scores
// nullable precisely so an operator can walk a fixture back to "no result yet".
// A non-empty non-number stays NaN so it surfaces as a field error rather than
// being silently read as a clear (which is what `Number("")`'s 0 would hide).
function toNullableNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : Number(trimmed);
}

export function isFixtureFormDirty(seed: FixtureFormValues, value: FixtureFormValues): boolean {
  return (Object.keys(seed) as (keyof FixtureFormValues)[]).some((key) => seed[key] !== value[key]);
}

/**
 * Builds the PATCH body from **only the fields the operator actually changed**.
 *
 * Sending every field looks harmless because the wire schema accepts it, but
 * `kickoffAt` round-trips through a `datetime-local` input that has no seconds
 * component — so an untouched kickoff would be rewritten truncated to the whole
 * minute on every save, silently moving the very boundary this tool exists to
 * test. Diffing against the seed also stops an editor left open across a
 * refetch from writing its stale values back.
 */
export function buildFixturePatch(
  seed: FixtureFormValues,
  value: FixtureFormValues,
): FixturePatchResult {
  const patch: UpdateSimFixtureGameRequest = {};
  const fieldErrors: FixtureFieldErrors = {};

  if (value.kickoffAt !== seed.kickoffAt) {
    // Guarded before `toISOString`, which throws RangeError on an invalid Date
    // rather than producing something the schema could reject. A
    // `datetime-local` reports "" when cleared or partially filled.
    const kickoffMs = Date.parse(value.kickoffAt);
    if (Number.isNaN(kickoffMs)) {
      fieldErrors.kickoffAt = "Enter a valid kickoff date and time.";
    } else {
      patch.kickoffAt = new Date(kickoffMs).toISOString();
    }
  }

  if (value.weekType !== seed.weekType) patch.weekType = value.weekType;
  if (value.finalStatus !== seed.finalStatus) patch.finalStatus = value.finalStatus;

  if (value.weekNumber !== seed.weekNumber) {
    const weekNumber = toNullableNumber(value.weekNumber);
    if (weekNumber === null || Number.isNaN(weekNumber)) {
      fieldErrors.weekNumber = "Enter a week number.";
    } else {
      patch.weekNumber = weekNumber;
    }
  }

  for (const key of ["spread", "finalHomeScore", "finalAwayScore"] as const) {
    if (value[key] === seed[key]) continue;
    const parsed = toNullableNumber(value[key]);
    if (parsed !== null && Number.isNaN(parsed)) {
      fieldErrors[key] = "Enter a number, or leave blank to clear it.";
    } else {
      patch[key] = parsed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { status: "invalid", fieldErrors };
  // The wire schema's `.refine` rejects an empty body, but "nothing changed" is
  // a no-op rather than an error the operator should have to read.
  if (Object.keys(patch).length === 0) return { status: "unchanged" };

  // Range rules (week 1-18, scores 0-200) stay the schema's to enforce — this
  // never restates them.
  const parsed = UpdateSimFixtureGameRequestSchema.safeParse(patch);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        fieldErrors[key as keyof FixtureFormValues] = issue.message;
      }
    }
    return { status: "invalid", fieldErrors };
  }

  return { status: "ok", patch: parsed.data };
}
