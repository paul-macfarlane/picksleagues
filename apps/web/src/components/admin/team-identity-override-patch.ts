import {
  TeamIdentityOverrideRequestSchema,
  type AdminTeam,
  type TeamIdentityOverrideRequest,
} from "@picksleagues/schemas";

/**
 * The team identity editor's string↔wire conversion, pure like
 * `nfl-stats-override-patch.ts` and for the same reason: "cleared" vs
 * "unchanged" vs "set" is where the bugs live, and it must be testable without
 * a form. Fields seed from the *override* values, never the resolved ones —
 * seeding from `effective*` would copy provider truth into the override
 * columns and pin values that should have kept tracking the provider
 * (arch D15). All-string fields, so unlike the numeric tables there is no
 * parse step: an empty input is the clear, anything else is the value.
 */

export const TEAM_IDENTITY_OVERRIDE_FIELDS = [
  "name",
  "abbreviation",
  "location",
  "logoLightUrl",
  "logoDarkUrl",
] as const;

export type TeamIdentityOverrideField = (typeof TEAM_IDENTITY_OVERRIDE_FIELDS)[number];

export type TeamIdentityOverrideFormValues = Record<TeamIdentityOverrideField, string>;

export type TeamIdentityOverrideFieldErrors = Partial<Record<TeamIdentityOverrideField, string>>;

export type TeamIdentityOverridePatchResult =
  | { status: "unchanged" }
  | { status: "invalid"; fieldErrors: TeamIdentityOverrideFieldErrors }
  | { status: "ok"; patch: TeamIdentityOverrideRequest };

const OVERRIDE_COLUMN: Record<TeamIdentityOverrideField, keyof AdminTeam> = {
  name: "overrideName",
  abbreviation: "overrideAbbreviation",
  location: "overrideLocation",
  logoLightUrl: "overrideLogoLightUrl",
  logoDarkUrl: "overrideLogoDarkUrl",
};

export function teamIdentityOverrideFormSeed(team: AdminTeam): TeamIdentityOverrideFormValues {
  return Object.fromEntries(
    TEAM_IDENTITY_OVERRIDE_FIELDS.map((field) => [
      field,
      (team[OVERRIDE_COLUMN[field]] as string | null) ?? "",
    ]),
  ) as TeamIdentityOverrideFormValues;
}

export function isTeamIdentityOverrideFormDirty(
  seed: TeamIdentityOverrideFormValues,
  value: TeamIdentityOverrideFormValues,
): boolean {
  // Trimmed like the patch builder's diff below — the two must agree on what
  // "changed" means, or a trailing space enables a Save that submits nothing.
  return TEAM_IDENTITY_OVERRIDE_FIELDS.some((field) => seed[field] !== value[field].trim());
}

/**
 * Builds the request from **only the fields the operator actually changed**
 * (the wire shape's third state): an omitted field leaves its stored override
 * alone, so an editor left open across a refetch can't write stale values
 * back. An emptied field is an explicit clear (null).
 */
export function buildTeamIdentityOverridePatch(
  seed: TeamIdentityOverrideFormValues,
  value: TeamIdentityOverrideFormValues,
): TeamIdentityOverridePatchResult {
  const patch: TeamIdentityOverrideRequest = {};

  for (const field of TEAM_IDENTITY_OVERRIDE_FIELDS) {
    // Compared trimmed, because the patch sends trimmed: a trailing space on
    // an otherwise-unchanged field must not become a no-op write whose only
    // effect is a bumped overridden_at and an audit row recording nothing.
    const trimmed = value[field].trim();
    if (trimmed === seed[field]) continue;
    patch[field] = trimmed === "" ? null : trimmed;
  }

  if (Object.keys(patch).length === 0) return { status: "unchanged" };

  // Length and URL rules stay the schema's to enforce — never restated here.
  const parsed = TeamIdentityOverrideRequestSchema.safeParse(patch);
  if (!parsed.success) {
    const fieldErrors: TeamIdentityOverrideFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        fieldErrors[key as TeamIdentityOverrideField] = issue.message;
      }
    }
    return { status: "invalid", fieldErrors };
  }

  return { status: "ok", patch: parsed.data };
}
