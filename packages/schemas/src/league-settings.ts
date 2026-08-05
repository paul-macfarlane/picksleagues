import { z } from "@hono/zod-openapi";
import { LEAGUE_MODE, type LeagueMode } from "./league-mode";
import { PickTypeSchema } from "./pick-type";
import { WEEK_TYPE } from "./week-type";

/**
 * Per-mode league settings, stored as validated JSONB on `league_seasons`
 * (ADR-0009). These schemas are the single write-side gate: the API
 * validates against the mode's schema before persisting, and Drizzle types
 * the column via `$type<LeagueSettings>`. Deferred features (confidence
 * scoring, buy-backs, MM bonuses) are enforced by omission from these shapes
 * (arch §MVP Rule Scope) — adding them later is a schema change, not a
 * migration of shared tables.
 */

/**
 * A settings-level reference into the `weeks` table, matching its
 * `(week_type, week_number)` identity. NFL postseason rounds restart at 1
 * (Wild Card=1 … Super Bowl=4), so a bare number can't address them.
 */
const nflRegularWeekRef = z.object({
  type: z.literal(WEEK_TYPE.REGULAR),
  number: z.number().int().min(1).max(18),
});

const nflPostseasonWeekRef = z.object({
  type: z.literal(WEEK_TYPE.POSTSEASON),
  number: z.number().int().min(1).max(4),
});

export const NflWeekRefSchema = z
  .discriminatedUnion("type", [nflRegularWeekRef, nflPostseasonWeekRef])
  .openapi("NflWeekRef");

export type NflWeekRef = z.infer<typeof NflWeekRefSchema>;

/**
 * Position of a week in whole-season order — playoff rounds follow week 18
 * (spec §Pick'em League Settings), so ordering start/end weeks across the
 * regular/postseason boundary needs a single scale.
 */
export function nflSeasonOrdinal(week: NflWeekRef): number {
  return week.type === WEEK_TYPE.REGULAR ? week.number : 18 + week.number;
}

/**
 * Ceiling on Picks Per Week (spec §Pick'em League Settings) — also the most
 * games any NFL week can offer, which is why the batch pick endpoint bounds its
 * array by the same number.
 */
export const MAX_PICKS_PER_WEEK = 16;

export const PickemSettingsSchema = z
  .object({
    startWeek: NflWeekRefSchema,
    endWeek: NflWeekRefSchema,
    pickType: PickTypeSchema,
    picksPerWeek: z.number().int().min(1).max(MAX_PICKS_PER_WEEK).default(5),
  })
  .refine((s) => nflSeasonOrdinal(s.endWeek) >= nflSeasonOrdinal(s.startWeek), {
    message: "End week must be at or after the start week in season order.",
    path: ["endWeek"],
  })
  .openapi("PickemSettings");

export type PickemSettings = z.infer<typeof PickemSettingsSchema>;

/**
 * Whether a Pick'em settings edit invalidates already-submitted picks (spec
 * §Commissioner Powers's pick-safety rule). Shared by the API's pre-start
 * settings write (`resetPicksInvalidatedBySettings`, which clears invalidated
 * picks) and the web settings editor (which warns before that happens) — one
 * rule, so the two surfaces can never disagree about what a save destroys.
 *
 * Each clause names the exact way it could strand a pick made legally under
 * the old settings:
 * - switching Pick Type to ATS leaves picks with no spread, which settlement
 *   cannot grade at all (it throws by design rather than guess);
 * - *any* change to Picks Per Week leaves already-submitted members the wrong
 *   size. Lowering it puts them over the cap; raising it leaves them under —
 *   and under submit-once (ADR-0018) a member submits exactly `picksAllowed`
 *   picks and can never submit again, so a raise would strand them permanently
 *   undersized with no re-submit path. Clearing their picks re-opens the week,
 *   which is the only outcome that leaves every member able to comply;
 * - narrowing the week range orphans picks in weeks no longer in the league.
 *
 * Widening the week range is the one edit that strands nothing: every existing
 * pick still sits in a week the league plays.
 */
export function pickemSettingsInvalidatePicks(
  previous: PickemSettings,
  next: PickemSettings,
): boolean {
  return (
    previous.pickType !== next.pickType ||
    next.picksPerWeek !== previous.picksPerWeek ||
    nflSeasonOrdinal(next.startWeek) > nflSeasonOrdinal(previous.startWeek) ||
    nflSeasonOrdinal(next.endWeek) < nflSeasonOrdinal(previous.endWeek)
  );
}

/**
 * On an ATS push / SU tie in Elimination (spec §Elimination League Settings):
 * advance with the team consumed (default), or eliminate.
 */
export const ELIMINATION_PUSH_TIE_RESOLUTION = {
  ADVANCE: "advance",
  ELIMINATE: "eliminate",
} as const;

export type EliminationPushTieResolution =
  (typeof ELIMINATION_PUSH_TIE_RESOLUTION)[keyof typeof ELIMINATION_PUSH_TIE_RESOLUTION];

export const EliminationPushTieResolutionSchema = z
  .enum(ELIMINATION_PUSH_TIE_RESOLUTION)
  .openapi("EliminationPushTieResolution");

// Elimination is regular-season only (spec §Elimination Core Rules) — the
// week refs still carry `type` so both NFL modes' settings address weeks with
// one shape, but only the regular member is admitted.
export const EliminationSettingsSchema = z
  .object({
    startWeek: nflRegularWeekRef,
    endWeek: nflRegularWeekRef,
    pickType: PickTypeSchema,
    pushTieResolution: EliminationPushTieResolutionSchema.default(
      ELIMINATION_PUSH_TIE_RESOLUTION.ADVANCE,
    ),
  })
  .refine((s) => s.endWeek.number >= s.startWeek.number, {
    message: "End week must be at or after the start week.",
    path: ["endWeek"],
  })
  .openapi("EliminationSettings");

export type EliminationSettings = z.infer<typeof EliminationSettingsSchema>;

export const MARCH_MADNESS_SCORING_MODEL = {
  STANDARD_DOUBLING: "standard_doubling",
  CUSTOM: "custom",
} as const;

export type MarchMadnessScoringModel =
  (typeof MARCH_MADNESS_SCORING_MODEL)[keyof typeof MARCH_MADNESS_SCORING_MODEL];

export const MarchMadnessScoringModelSchema = z
  .enum(MARCH_MADNESS_SCORING_MODEL)
  .openapi("MarchMadnessScoringModel");

const marchMadnessBaseSettings = {
  maxBracketsPerMember: z.number().int().min(1).max(10).default(5),
};

// Custom scoring sets each round's per-correct-pick value independently
// (spec §MM League Settings): six values, R64 → Championship, any
// non-negative integer. `roundValues` exists only under the custom model so
// a standard-doubling league can't carry stale round values.
export const MarchMadnessSettingsSchema = z
  .discriminatedUnion("scoringModel", [
    z.object({
      ...marchMadnessBaseSettings,
      scoringModel: z.literal(MARCH_MADNESS_SCORING_MODEL.STANDARD_DOUBLING),
    }),
    z.object({
      ...marchMadnessBaseSettings,
      scoringModel: z.literal(MARCH_MADNESS_SCORING_MODEL.CUSTOM),
      roundValues: z.array(z.number().int().min(0)).length(6),
    }),
  ])
  .openapi("MarchMadnessSettings");

export type MarchMadnessSettings = z.infer<typeof MarchMadnessSettingsSchema>;

export type LeagueSettings = PickemSettings | EliminationSettings | MarchMadnessSettings;

// Read-side shape for responses, where the mode discriminant lives on the
// league itself — clients narrow by `league.mode`, not by inspecting settings.
export const LeagueSettingsSchema = z
  .union([PickemSettingsSchema, EliminationSettingsSchema, MarchMadnessSettingsSchema])
  .openapi("LeagueSettings");

/**
 * Write-side dispatch: the schema a given league's settings must satisfy,
 * selected by `leagues.mode`. Every settings write (create + pre-start edit)
 * validates through this map.
 */
export const LEAGUE_SETTINGS_SCHEMAS = {
  [LEAGUE_MODE.PICKEM]: PickemSettingsSchema,
  [LEAGUE_MODE.ELIMINATION]: EliminationSettingsSchema,
  [LEAGUE_MODE.MARCH_MADNESS]: MarchMadnessSettingsSchema,
} as const satisfies Record<LeagueMode, z.ZodType<LeagueSettings, unknown>>;
