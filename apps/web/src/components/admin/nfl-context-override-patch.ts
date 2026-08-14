import {
  NflGameStatContextOverrideRequestSchema,
  type AdminNflGameStatContextBlock,
  type NflGameStatContextOverrideRequest,
  type NflTeamGameContextOverride,
} from "@picksleagues/schemas";
import { toNullableNumber } from "@/components/admin/override-input";

/**
 * The context override editor's string↔wire conversion (pure, like its
 * siblings). Unlike the column-table patches this builds a **whole
 * replacement** of the override layer (PUT semantics — the layer is one JSONB
 * value), so it converts from *current values wholesale* rather than diffing
 * against the seed; the seed exists only for dirty-gating the save. An empty
 * input is "no override for this field", and a fully empty form clears the
 * layer (the server stores NULL — arch D15's clean revert).
 *
 * The two list fields edit as JSON text (owner, 2026-08-13): a structured
 * row editor for an admin-only, friends-scale surface wasn't worth its build
 * cost. The shared Zod schemas still gate the save, so bad JSON or a bad
 * shape lands as a field error, never on the wire.
 */

const SIDES = ["home", "away"] as const;
type Side = (typeof SIDES)[number];

const SIDE_FIELDS = ["injuries", "fpiWinPct", "atsSummary", "lastFive"] as const;
type SideField = (typeof SIDE_FIELDS)[number];

export type NflContextOverrideFieldKey = `${Side}:${SideField}`;

export const NFL_CONTEXT_OVERRIDE_FIELDS: NflContextOverrideFieldKey[] = SIDES.flatMap((side) =>
  SIDE_FIELDS.map((field): NflContextOverrideFieldKey => `${side}:${field}`),
);

export type NflContextOverrideFormValues = Record<NflContextOverrideFieldKey, string>;

export type NflContextOverrideFieldErrors = Partial<Record<NflContextOverrideFieldKey, string>>;

export type NflContextOverridePatchResult =
  | { status: "invalid"; fieldErrors: NflContextOverrideFieldErrors }
  | { status: "ok"; request: NflGameStatContextOverrideRequest };

function jsonToInput(value: unknown | undefined): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

export function nflContextOverrideFormSeed(
  block: AdminNflGameStatContextBlock,
): NflContextOverrideFormValues {
  const seed = {} as NflContextOverrideFormValues;
  for (const side of SIDES) {
    const override = block.overridePayload?.[side];
    seed[`${side}:injuries`] = jsonToInput(override?.injuries);
    seed[`${side}:fpiWinPct`] = override?.fpiWinPct === undefined ? "" : String(override.fpiWinPct);
    seed[`${side}:atsSummary`] = override?.atsSummary ?? "";
    seed[`${side}:lastFive`] = jsonToInput(override?.lastFive);
  }
  return seed;
}

export function isNflContextOverrideFormDirty(
  seed: NflContextOverrideFormValues,
  value: NflContextOverrideFormValues,
): boolean {
  return NFL_CONTEXT_OVERRIDE_FIELDS.some((field) => seed[field] !== value[field]);
}

type ParsedSide = { side: NflTeamGameContextOverride; errors: NflContextOverrideFieldErrors };

function parseSide(sideKey: Side, values: NflContextOverrideFormValues): ParsedSide {
  const side: NflTeamGameContextOverride = {};
  const errors: NflContextOverrideFieldErrors = {};

  for (const listField of ["injuries", "lastFive"] as const) {
    const raw = values[`${sideKey}:${listField}`].trim();
    if (raw === "") continue;
    try {
      // Shape (array-ness, entry fields, bounds) is the schema's to judge in
      // the final safeParse — this only turns text into a value.
      side[listField] = JSON.parse(raw) as never;
    } catch {
      errors[`${sideKey}:${listField}`] =
        "Enter valid JSON, or leave blank for no override on this field.";
    }
  }

  const fpiRaw = values[`${sideKey}:fpiWinPct`];
  const fpi = toNullableNumber(fpiRaw);
  if (fpi !== null) {
    if (Number.isNaN(fpi)) {
      errors[`${sideKey}:fpiWinPct`] =
        "Enter a number, or leave blank for no override on this field.";
    } else {
      side.fpiWinPct = fpi;
    }
  }

  const ats = values[`${sideKey}:atsSummary`].trim();
  if (ats !== "") side.atsSummary = ats;

  return { side, errors };
}

export function buildNflContextOverrideRequest(
  values: NflContextOverrideFormValues,
): NflContextOverridePatchResult {
  const request: NflGameStatContextOverrideRequest = {};
  const fieldErrors: NflContextOverrideFieldErrors = {};

  for (const sideKey of SIDES) {
    const { side, errors } = parseSide(sideKey, values);
    Object.assign(fieldErrors, errors);
    if (Object.keys(side).length > 0) request[sideKey] = side;
  }

  if (Object.keys(fieldErrors).length > 0) return { status: "invalid", fieldErrors };

  const parsed = NflGameStatContextOverrideRequestSchema.safeParse(request);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [side, field] = issue.path;
      if (
        (side === "home" || side === "away") &&
        typeof field === "string" &&
        (SIDE_FIELDS as readonly string[]).includes(field)
      ) {
        const key: NflContextOverrideFieldKey = `${side}:${field as SideField}`;
        // First issue per field wins — one message per input is readable;
        // a concatenated list of nested-entry issues is not.
        fieldErrors[key] ??= issue.message;
      }
    }
    // An issue that doesn't map to a field (shouldn't happen — every path
    // starts home/away) still blocks the save with a generic top-level error.
    if (Object.keys(fieldErrors).length === 0) {
      fieldErrors["home:injuries"] = "The override didn't match the expected shape.";
    }
    return { status: "invalid", fieldErrors };
  }

  return { status: "ok", request: parsed.data };
}
