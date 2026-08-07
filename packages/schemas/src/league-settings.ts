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

/**
 * The season range a Pick'em league covers, as a commissioner names it
 * (ADR-0020). Replaces the explicit start/end week pair as the *input*; the
 * concrete refs it resolves to are still what gets stored and computed on.
 */
export const PICKEM_SEASON_RANGE_PRESET = {
  REGULAR_SEASON: "regular_season",
  POSTSEASON: "postseason",
  FULL_SEASON: "full_season",
} as const;

export type PickemSeasonRangePreset =
  (typeof PICKEM_SEASON_RANGE_PRESET)[keyof typeof PICKEM_SEASON_RANGE_PRESET];

export const PickemSeasonRangePresetSchema = z
  .enum(PICKEM_SEASON_RANGE_PRESET)
  .openapi("PickemSeasonRangePreset");

/**
 * The two week refs a season range resolves to — what the rest of the system
 * computes on. Mode-neutral because both NFL modes resolve into it: Pick'em
 * from a commissioner's preset (ADR-0020), Survivor from the one range its
 * mode allows (ADR-0024).
 */
export type NflSeasonRange = { startWeek: NflWeekRef; endWeek: NflWeekRef };

/**
 * The regular season as a range, with one home because two modes name it:
 * Pick'em's Regular Season preset (and the front half of Full Season), and the
 * whole of Survivor, which is regular-season only (ADR-0007) and therefore has
 * no preset to choose. A second copy of the week numbers could disagree with
 * itself about which weeks the regular season is.
 */
export const NFL_REGULAR_SEASON_RANGE = {
  startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
  endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
} as const satisfies NflSeasonRange;

/**
 * Each preset's nominal range (ADR-0020 §The three presets), in the week
 * vocabulary the spec already uses: regular-season weeks 1-18, then the four
 * playoff rounds Wild Card through Super Bowl.
 *
 * It lives beside the preset because it *is* the preset's definition, not a
 * detail of how the API resolves one. Two consumers read it: the server's
 * resolver, which starts from the nominal range and may advance the start past
 * a week already underway, and the web settings editor, which builds the draft
 * range it warns about from it. A second copy in either place would be a rule
 * able to disagree with itself about what "Regular Season" covers.
 */
export const PICKEM_NOMINAL_RANGE = {
  [PICKEM_SEASON_RANGE_PRESET.REGULAR_SEASON]: NFL_REGULAR_SEASON_RANGE,
  [PICKEM_SEASON_RANGE_PRESET.POSTSEASON]: {
    startWeek: { type: WEEK_TYPE.POSTSEASON, number: 1 },
    endWeek: { type: WEEK_TYPE.POSTSEASON, number: 4 },
  },
  [PICKEM_SEASON_RANGE_PRESET.FULL_SEASON]: {
    startWeek: NFL_REGULAR_SEASON_RANGE.startWeek,
    endWeek: { type: WEEK_TYPE.POSTSEASON, number: 4 },
  },
} as const satisfies Record<PickemSeasonRangePreset, NflSeasonRange>;

/**
 * The create form's and the settings editor's shared availability answer
 * (`GET /pickem/season-range-presets`, `GET
 * /leagues/{leagueId}/pickem/season-range-presets`): which presets the
 * relevant season can still start, and that season's year. `seasonYear` is
 * `null` only when no NFL season has been ingested at all — reachable from
 * the create-form endpoint, never the league-scoped one (a league always has
 * a bound season). A fresh component, not a `.nullable()` wrap of an
 * already-registered schema (engineering rules §Contract & codegen — the
 * wrapper would inherit the registration and widen every other `$ref` to it).
 */
export const PickemSeasonRangePresetsResponseSchema = z
  .object({
    seasonYear: z.number().nullable(),
    startablePresets: z.array(PickemSeasonRangePresetSchema),
  })
  .openapi("PickemSeasonRangePresetsResponse");

export type PickemSeasonRangePresetsResponse = z.infer<
  typeof PickemSeasonRangePresetsResponseSchema
>;

/**
 * Stored Pick'em settings: the commissioner's preset *and* the concrete week
 * refs it resolved to at the moment the setting was written (ADR-0020 §The
 * resolved range is stored, not re-derived). The refs are kept because
 * `leagueStartAt`, the join cutoff, `nflSeasonOrdinal` range checks and
 * `pickemSettingsInvalidatePicks` all compute on them — none of them needed to
 * learn about presets.
 */
export const PickemSettingsSchema = z
  .object({
    seasonRangePreset: PickemSeasonRangePresetSchema,
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
 * Wire shape for a Pick'em settings write — the preset, and no week refs
 * (ADR-0020 §The wire shape diverges from the stored shape). The omission is
 * the point: a client that cannot name `startWeek`/`endWeek` cannot dictate the
 * range the server resolves against the season and the clock, and no stripping
 * step on the write path can be forgotten.
 */
export const PickemSettingsInputSchema = z
  .object({
    seasonRangePreset: PickemSeasonRangePresetSchema,
    pickType: PickTypeSchema,
    picksPerWeek: z.number().int().min(1).max(MAX_PICKS_PER_WEEK).default(5),
  })
  .openapi("PickemSettingsInput");

export type PickemSettingsInput = z.infer<typeof PickemSettingsInputSchema>;

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
 * On an ATS push / SU tie in Survivor (spec §Survivor League Settings):
 * advance with the team consumed (default), or eliminate.
 */
export const SURVIVOR_PUSH_TIE_RESOLUTION = {
  ADVANCE: "advance",
  ELIMINATE: "eliminate",
} as const;

export type SurvivorPushTieResolution =
  (typeof SURVIVOR_PUSH_TIE_RESOLUTION)[keyof typeof SURVIVOR_PUSH_TIE_RESOLUTION];

export const SurvivorPushTieResolutionSchema = z
  .enum(SURVIVOR_PUSH_TIE_RESOLUTION)
  .openapi("SurvivorPushTieResolution");

/**
 * Survivor is regular-season only (spec §Survivor Core Rules) — the
 * week refs still carry `type` so both NFL modes' settings address weeks with
 * one shape, but only the regular member is admitted.
 */
export const SurvivorSettingsSchema = z
  .object({
    startWeek: nflRegularWeekRef,
    endWeek: nflRegularWeekRef,
    pickType: PickTypeSchema,
    pushTieResolution: SurvivorPushTieResolutionSchema.default(
      SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
    ),
  })
  .refine((s) => s.endWeek.number >= s.startWeek.number, {
    message: "End week must be at or after the start week.",
    path: ["endWeek"],
  })
  .openapi("SurvivorSettings");

export type SurvivorSettings = z.infer<typeof SurvivorSettingsSchema>;

/**
 * Wire shape for a Survivor settings write (ADR-0024): the pick type and the
 * push/tie rule, and nothing about the season range. Unlike Pick'em's input
 * there is no preset field either — Survivor is regular-season only
 * (ADR-0007), so its one legal range is implicit in the mode and the server
 * resolves the concrete refs it stores against the bound season and the clock.
 *
 * Strict, where Pick'em's input merely strips unknown keys: a Survivor request
 * naming week refs comes from a client that believes it chose a range, and
 * discarding that silently would create a league covering weeks nobody asked
 * for. Pick'em's request still carries its `seasonRangePreset` when stray refs
 * are stripped alongside it; here there would be nothing left of the intent.
 */
export const SurvivorSettingsInputSchema = z
  .strictObject({
    pickType: PickTypeSchema,
    pushTieResolution: SurvivorPushTieResolutionSchema.default(
      SURVIVOR_PUSH_TIE_RESOLUTION.ADVANCE,
    ),
  })
  .openapi("SurvivorSettingsInput");

export type SurvivorSettingsInput = z.infer<typeof SurvivorSettingsInputSchema>;

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

/**
 * Custom scoring sets each round's per-correct-pick value independently
 * (spec §MM League Settings): six values, R64 → Championship, any
 * non-negative integer. `roundValues` exists only under the custom model so
 * a standard-doubling league can't carry stale round values.
 */
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

export type LeagueSettings = PickemSettings | SurvivorSettings | MarchMadnessSettings;

/**
 * Read-side shape for responses, where the mode discriminant lives on the
 * league itself — clients narrow by `league.mode`, not by inspecting settings.
 */
export const LeagueSettingsSchema = z
  .union([PickemSettingsSchema, SurvivorSettingsSchema, MarchMadnessSettingsSchema])
  .openapi("LeagueSettings");

/**
 * Write-side dispatch: the schema a given league's settings must satisfy,
 * selected by `leagues.mode`. Every settings write (create + pre-start edit)
 * validates through this map.
 */
export const LEAGUE_SETTINGS_SCHEMAS = {
  [LEAGUE_MODE.PICKEM]: PickemSettingsSchema,
  [LEAGUE_MODE.SURVIVOR]: SurvivorSettingsSchema,
  [LEAGUE_MODE.MARCH_MADNESS]: MarchMadnessSettingsSchema,
} as const satisfies Record<LeagueMode, z.ZodType<LeagueSettings, unknown>>;

export type LeagueSettingsInput =
  PickemSettingsInput | SurvivorSettingsInput | MarchMadnessSettings;

/**
 * Wire-side dispatch, the counterpart to `LEAGUE_SETTINGS_SCHEMAS`: the schema
 * a settings *request* must satisfy. Both NFL modes' entries differ from the
 * stored map, because both have their season range resolved server-side rather
 * than chosen — Pick'em from a preset (ADR-0020), Survivor from the one range
 * its mode allows (ADR-0024). March Madness has no season range at all, so it
 * accepts exactly what it stores and its wire and stored schemas are the same
 * object rather than a duplicate that could drift.
 */
export const LEAGUE_SETTINGS_INPUT_SCHEMAS = {
  [LEAGUE_MODE.PICKEM]: PickemSettingsInputSchema,
  [LEAGUE_MODE.SURVIVOR]: SurvivorSettingsInputSchema,
  [LEAGUE_MODE.MARCH_MADNESS]: MarchMadnessSettingsSchema,
} as const satisfies Record<LeagueMode, z.ZodType<LeagueSettingsInput, unknown>>;
