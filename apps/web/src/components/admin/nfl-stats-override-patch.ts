import {
  NflTeamSeasonStatsOverrideRequestSchema,
  type AdminNflTeamSeasonStats,
  type NflTeamSeasonStatsOverrideRequest,
} from "@picksleagues/schemas";
import { nullableToInput, toNullableNumber } from "@/components/admin/override-input";

/**
 * The stats override editor's string↔wire conversion, pure like
 * `game-override-patch.ts` and for the same reason: "cleared" vs "unchanged"
 * vs "set" is where the bugs live, and it must be testable without a form.
 * Fields seed from the *override* values, never the resolved ones — seeding
 * from `effective*` would copy provider truth into the override columns and
 * pin values that should have kept tracking the provider (arch D15).
 */

export const NFL_STATS_OVERRIDE_FIELDS = [
  "wins",
  "losses",
  "ties",
  "homeWins",
  "homeLosses",
  "homeTies",
  "roadWins",
  "roadLosses",
  "roadTies",
  "streak",
  "pointsFor",
  "pointsAgainst",
] as const;

export type NflStatsOverrideField = (typeof NFL_STATS_OVERRIDE_FIELDS)[number];

export type NflStatsOverrideFormValues = Record<NflStatsOverrideField, string>;

export type NflStatsOverrideFieldErrors = Partial<Record<NflStatsOverrideField, string>>;

export type NflStatsOverridePatchResult =
  | { status: "unchanged" }
  | { status: "invalid"; fieldErrors: NflStatsOverrideFieldErrors }
  | { status: "ok"; patch: NflTeamSeasonStatsOverrideRequest };

const OVERRIDE_COLUMN: Record<NflStatsOverrideField, keyof AdminNflTeamSeasonStats> = {
  wins: "overrideWins",
  losses: "overrideLosses",
  ties: "overrideTies",
  homeWins: "overrideHomeWins",
  homeLosses: "overrideHomeLosses",
  homeTies: "overrideHomeTies",
  roadWins: "overrideRoadWins",
  roadLosses: "overrideRoadLosses",
  roadTies: "overrideRoadTies",
  streak: "overrideStreak",
  pointsFor: "overridePointsFor",
  pointsAgainst: "overridePointsAgainst",
};

export function nflStatsOverrideFormSeed(
  stats: AdminNflTeamSeasonStats,
): NflStatsOverrideFormValues {
  return Object.fromEntries(
    NFL_STATS_OVERRIDE_FIELDS.map((field) => [
      field,
      nullableToInput(stats[OVERRIDE_COLUMN[field]] as number | null),
    ]),
  ) as NflStatsOverrideFormValues;
}

export function isNflStatsOverrideFormDirty(
  seed: NflStatsOverrideFormValues,
  value: NflStatsOverrideFormValues,
): boolean {
  return NFL_STATS_OVERRIDE_FIELDS.some((field) => seed[field] !== value[field]);
}

/**
 * Builds the request from **only the fields the operator actually changed**
 * (the wire shape's third state): an omitted field leaves its stored override
 * alone, so an editor left open across a refetch can't write stale values back.
 */
export function buildNflStatsOverridePatch(
  seed: NflStatsOverrideFormValues,
  value: NflStatsOverrideFormValues,
): NflStatsOverridePatchResult {
  const patch: NflTeamSeasonStatsOverrideRequest = {};
  const fieldErrors: NflStatsOverrideFieldErrors = {};

  for (const field of NFL_STATS_OVERRIDE_FIELDS) {
    if (value[field] === seed[field]) continue;
    const parsed = toNullableNumber(value[field]);
    if (parsed !== null && Number.isNaN(parsed)) {
      fieldErrors[field] = "Enter a number, or leave blank to use the provider's value.";
    } else {
      patch[field] = parsed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { status: "invalid", fieldErrors };
  if (Object.keys(patch).length === 0) return { status: "unchanged" };

  // Range rules stay the schema's to enforce — never restated here.
  const parsed = NflTeamSeasonStatsOverrideRequestSchema.safeParse(patch);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        fieldErrors[key as NflStatsOverrideField] = issue.message;
      }
    }
    return { status: "invalid", fieldErrors };
  }

  return { status: "ok", patch: parsed.data };
}
