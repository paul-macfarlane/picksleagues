import {
  GameOverrideRequestSchema,
  type AdminGame,
  type GameOverrideRequest,
  type GameStatus,
} from "@picksleagues/schemas";
import { toLocalDateTimeInputValue } from "@/lib/format";

/**
 * The override editor's string↔wire conversion, kept pure and out of the
 * component so the boundary that actually carries the bugs — "cleared" vs
 * "unchanged" vs "set", and which fields a save is allowed to touch — is
 * unit-testable without mounting a form.
 *
 * Every field seeds from the *override* value, never the resolved one: the
 * operator is editing the correction layer, and seeding from `effective*` would
 * turn every save into a copy of provider truth into the override columns —
 * pinning values that should have kept tracking the provider (arch D15).
 */
export type GameOverrideFormValues = {
  /** "" means "no kickoff override" — cleared back to provider truth. */
  kickoffAt: string;
  status: GameOverrideStatusValue;
  homeScore: string;
  awayScore: string;
  spread: string;
};

/**
 * The status select's "no override" option. A sentinel rather than the empty
 * string because Base UI's Select treats "" as no selection, and it can't
 * collide with a real status — `GAME_STATUS` has no `none` member.
 */
export const NO_STATUS_OVERRIDE = "none";

export type GameOverrideStatusValue = GameStatus | typeof NO_STATUS_OVERRIDE;

export type GameOverrideFieldErrors = Partial<Record<keyof GameOverrideFormValues, string>>;

export type GameOverridePatchResult =
  | { status: "unchanged" }
  | { status: "invalid"; fieldErrors: GameOverrideFieldErrors }
  | { status: "ok"; patch: GameOverrideRequest };

export function gameOverrideFormSeed(game: AdminGame): GameOverrideFormValues {
  return {
    kickoffAt:
      game.overrideKickoffAt === null ? "" : toLocalDateTimeInputValue(game.overrideKickoffAt),
    status: game.overrideStatus ?? NO_STATUS_OVERRIDE,
    homeScore: nullableToInput(game.overrideHomeScore),
    awayScore: nullableToInput(game.overrideAwayScore),
    spread: nullableToInput(game.overrideSpread),
  };
}

function nullableToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

// An empty field is an explicit clear — the wire schema makes every field
// nullable precisely so "revert to provider truth" is expressible (arch D15:
// "clear override is a null-out"). A non-empty non-number stays NaN so it
// surfaces as a field error rather than being read as a clear (which is what
// `Number("")`'s 0 would hide).
function toNullableNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : Number(trimmed);
}

export function isGameOverrideFormDirty(
  seed: GameOverrideFormValues,
  value: GameOverrideFormValues,
): boolean {
  return (Object.keys(seed) as (keyof GameOverrideFormValues)[]).some(
    (key) => seed[key] !== value[key],
  );
}

/**
 * Builds the request body from **only the fields the operator actually
 * changed**, which is what makes the wire shape's third state usable: an
 * omitted field leaves the stored override alone, so an untouched kickoff can't
 * be rewritten truncated to the whole minute by the date field's round trip,
 * and an editor left open across a refetch can't write its stale values back.
 */
export function buildGameOverridePatch(
  seed: GameOverrideFormValues,
  value: GameOverrideFormValues,
): GameOverridePatchResult {
  const patch: GameOverrideRequest = {};
  const fieldErrors: GameOverrideFieldErrors = {};

  if (value.kickoffAt !== seed.kickoffAt) {
    if (value.kickoffAt.trim() === "") {
      patch.kickoffAt = null;
    } else {
      // Guarded before `toISOString`, which throws RangeError on an invalid
      // Date rather than producing something the schema could reject.
      const kickoffMs = Date.parse(value.kickoffAt);
      if (Number.isNaN(kickoffMs)) {
        fieldErrors.kickoffAt = "Enter a valid kickoff date and time, or clear it.";
      } else {
        patch.kickoffAt = new Date(kickoffMs).toISOString();
      }
    }
  }

  if (value.status !== seed.status) {
    patch.status = value.status === NO_STATUS_OVERRIDE ? null : value.status;
  }

  for (const key of ["homeScore", "awayScore", "spread"] as const) {
    if (value[key] === seed[key]) continue;
    const parsed = toNullableNumber(value[key]);
    if (parsed !== null && Number.isNaN(parsed)) {
      fieldErrors[key] = "Enter a number, or leave blank to use the provider's value.";
    } else {
      patch[key] = parsed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { status: "invalid", fieldErrors };
  // The wire schema's `.refine` rejects an empty body, but "nothing changed" is
  // a no-op rather than an error the operator should have to read.
  if (Object.keys(patch).length === 0) return { status: "unchanged" };

  // Range rules (scores 0-200, spread ±100) stay the schema's to enforce —
  // this never restates them.
  const parsed = GameOverrideRequestSchema.safeParse(patch);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        fieldErrors[key as keyof GameOverrideFormValues] = issue.message;
      }
    }
    return { status: "invalid", fieldErrors };
  }

  return { status: "ok", patch: parsed.data };
}
