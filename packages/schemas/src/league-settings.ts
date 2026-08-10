import { z } from "@hono/zod-openapi";
import { LEAGUE_MODE, type LeagueMode } from "./league-mode";
import { PickTypeSchema } from "./pick-type";
import { WEEK_TYPE, type WeekType } from "./week-type";

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
 * `(week_type, week_number)` identity. Both modes' stored ranges are
 * regular-season only (ADR-0024, ADR-0031), so this is the only ref a
 * settings blob may carry.
 */
const nflRegularWeekRef = z.object({
  type: z.literal(WEEK_TYPE.REGULAR),
  number: z.number().int().min(1).max(18),
});

/**
 * A week as the `weeks` table can address one. Postseason rounds restart at 1
 * (Wild Card=1 … Super Bowl=4), so a bare number can't address them — and they
 * still exist as *rows* (ingestion covers the postseason, ADR-0007/0021) even
 * though no league settings can name one since ADR-0031. The type survives the
 * settings schemas for exactly that reason: range clipping and settlement
 * ordering take arbitrary week rows, postseason included.
 */
export type NflWeekRef =
  | { type: typeof WEEK_TYPE.REGULAR; number: number }
  | { type: typeof WEEK_TYPE.POSTSEASON; number: number };

/**
 * Position of a week in whole-season order — postseason rows follow week 18,
 * so clipping arbitrary week rows against a regular-season range (and ordering
 * settlement replays) needs a single scale even though no stored range crosses
 * the boundary anymore (ADR-0031).
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
 * The two week refs a season range resolves to — what the rest of the system
 * computes on. Mode-neutral because both NFL modes resolve into it, from the
 * one range either mode allows (ADR-0024, ADR-0031).
 */
export type NflSeasonRange = { startWeek: NflWeekRef; endWeek: NflWeekRef };

/**
 * A stored `weeks` row addressed as a settings-level week ref, so the ordinal
 * scale above can be applied to it. Column-shaped rather than row-shaped on
 * purpose: the caller passes the two fields, and this package stays ignorant of
 * the table they came from.
 */
export function toNflWeekRef(week: { weekType: WeekType; weekNumber: number }): NflWeekRef {
  return week.weekType === WEEK_TYPE.REGULAR
    ? { type: WEEK_TYPE.REGULAR, number: week.weekNumber }
    : { type: WEEK_TYPE.POSTSEASON, number: week.weekNumber };
}

/**
 * Whether a league playing `range` plays this week — the clip every surface that
 * has to say "the weeks this league covers" applies: the member-facing week list,
 * both modes' settlement replays, and the conclusion derivations that decide when
 * a season's range has run out (ADR-0030).
 *
 * One home because the comparison spans the regular/postseason boundary, where
 * the naive `weekNumber` compare a reimplementation reaches for is wrong: a
 * league ending at Wild Card would otherwise read week 18 as *after* its end.
 */
export function isWeekInSeasonRange(
  week: { weekType: WeekType; weekNumber: number },
  range: NflSeasonRange,
): boolean {
  const ordinal = nflSeasonOrdinal(toNflWeekRef(week));
  return ordinal >= nflSeasonOrdinal(range.startWeek) && ordinal <= nflSeasonOrdinal(range.endWeek);
}

/**
 * The regular season as a range, with one home because both NFL modes resolve
 * it: each is regular-season only (Survivor by ADR-0024, Pick'em by ADR-0031),
 * so this is the one range a settings write can ever produce. A second copy of
 * the week numbers could disagree with itself about which weeks the regular
 * season is.
 */
export const NFL_REGULAR_SEASON_RANGE = {
  startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
  endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
} as const satisfies NflSeasonRange;

/**
 * Stored Pick'em settings: the concrete week refs the server resolved at the
 * moment the setting was written (ADR-0020's mid-week resolution rule, applied
 * to the fixed regular-season range by ADR-0031). The refs are stored because
 * `leagueStartAt`, the join cutoff, `nflSeasonOrdinal` range checks and
 * `pickemSettingsInvalidatePicks` all compute on them.
 */
export const PickemSettingsSchema = z
  .object({
    startWeek: nflRegularWeekRef,
    endWeek: nflRegularWeekRef,
    pickType: PickTypeSchema,
    picksPerWeek: z.number().int().min(1).max(MAX_PICKS_PER_WEEK).default(5),
  })
  .refine((s) => s.endWeek.number >= s.startWeek.number, {
    message: "End week must be at or after the start week.",
    path: ["endWeek"],
  })
  .openapi("PickemSettings");

export type PickemSettings = z.infer<typeof PickemSettingsSchema>;

/**
 * Wire shape for a Pick'em settings write: the pick rules, and no week refs —
 * Pick'em is regular-season only (ADR-0031), so its one legal range is
 * implicit in the mode and the server resolves the concrete refs it stores
 * against the bound season and the clock, exactly as Survivor's input works
 * (ADR-0024). The omission is the point: a client that cannot name
 * `startWeek`/`endWeek` cannot dictate the range, and no stripping step on the
 * write path can be forgotten. Stray keys are stripped rather than refused —
 * load-bearing for `seasonRangePreset`, which clients sent until ADR-0031.
 */
export const PickemSettingsInputSchema = z
  .object({
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
 * - advancing the start week orphans a pick in a week the league no longer
 *   plays. The range is re-resolved server-side on every pre-start settings
 *   write (ADR-0031, applying ADR-0024's rule), so a save can move the start
 *   forward without the commissioner ever naming a week.
 *
 * There is no narrowing-end clause: the end week is fixed at regular week 18
 * (ADR-0031) with no path that lowers it, so the clause would be inert — a
 * clause that can never be true reads as protection the code does not
 * actually provide (the same reasoning `survivorSettingsInvalidatePicks`
 * records below).
 */
export function pickemSettingsInvalidatePicks(
  previous: PickemSettings,
  next: PickemSettings,
): boolean {
  return (
    previous.pickType !== next.pickType ||
    next.picksPerWeek !== previous.picksPerWeek ||
    nflSeasonOrdinal(next.startWeek) > nflSeasonOrdinal(previous.startWeek)
  );
}

/**
 * Survivor is regular-season only (spec §Survivor Core Rules) — the
 * week refs still carry `type` so both NFL modes' settings address weeks with
 * one shape, but only the regular member is admitted. The resolved range is
 * the whole of the stored settings: Pick Type went with ADR-0026, and the
 * Push/Tie Resolution was fixed at its default — a tie advances with the team
 * consumed — by ADR-0033, so no rule knob remains.
 */
export const SurvivorSettingsSchema = z
  .object({
    startWeek: nflRegularWeekRef,
    endWeek: nflRegularWeekRef,
  })
  .refine((s) => s.endWeek.number >= s.startWeek.number, {
    message: "End week must be at or after the start week.",
    path: ["endWeek"],
  })
  .openapi("SurvivorSettings");

export type SurvivorSettings = z.infer<typeof SurvivorSettingsSchema>;

/**
 * Wire shape for a Survivor settings write: nothing at all. The season range
 * is resolved server-side (ADR-0024), the pick type is fixed by the mode
 * (ADR-0026), and the push/tie rule is fixed at advance-with-team-consumed
 * (ADR-0033) — a Survivor league has no rule left for a commissioner to
 * choose.
 *
 * As with Pick'em's input, the omission is the point and stray keys are simply
 * stripped: a client cannot dictate any of the above, so refusing the request
 * buys no safety the omission hasn't already bought — it only turns a client
 * that is merely out of date into a failed league creation. That is now
 * load-bearing for `pushTieResolution` too, which clients sent until
 * ADR-0033 (and `pickType` before it, until ADR-0026).
 */
export const SurvivorSettingsInputSchema = z.object({}).openapi("SurvivorSettingsInput");

export type SurvivorSettingsInput = z.infer<typeof SurvivorSettingsInputSchema>;

/**
 * Whether a Survivor settings edit invalidates already-submitted picks — this
 * mode's analog of `pickemSettingsInvalidatePicks` above, and the same rule
 * ADR-0015 decision 3 states for Pick'em. Shared by the API's pre-start
 * settings write (`resetPicksInvalidatedBySettings`, which clears invalidated
 * picks) and the web settings editor (which warns before that happens), so the
 * two surfaces can never disagree about what a save destroys.
 *
 * One clause, naming the one way an edit can strand a pick made legally under
 * the old settings: advancing the start week orphans a pick in a week the
 * league no longer plays. Survivor's range is re-resolved server-side on every
 * pre-start settings write (ADR-0024), so a save can move the start forward
 * without the commissioner ever naming a week — which is why this can fire on a
 * save whose wire body is byte-identical to the stored settings.
 *
 * Three Pick'em clauses have no counterpart here, and their absence is decided
 * rather than overlooked. Survivor has no rule settings left to change at all —
 * Pick Type is fixed by the mode (ADR-0026) and Push/Tie Resolution at its
 * default (ADR-0033) — so no stored pick can be stranded by a rule edit. And
 * the end week is fixed at regular week 18 (ADR-0024) with no path that lowers
 * it, so a narrowing-end clause would be inert — a clause that can never be
 * true reads as protection the code does not actually provide.
 */
export function survivorSettingsInvalidatePicks(
  previous: SurvivorSettings,
  next: SurvivorSettings,
): boolean {
  return nflSeasonOrdinal(next.startWeek) > nflSeasonOrdinal(previous.startWeek);
}

/**
 * Scoring is standard doubling only — the Custom per-round-values model was
 * cut before the mode was built (ADR-0034), so the round values live as
 * constants in the future scoring module, not here. Stray keys from the
 * retired shape (`scoringModel`, `roundValues`) are stripped, matching how
 * every other retired setting ages out.
 */
export const MarchMadnessSettingsSchema = z
  .object({
    maxBracketsPerMember: z.number().int().min(1).max(10).default(5),
  })
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
 * than chosen — each mode's one legal range is the regular season (ADR-0024,
 * ADR-0031). March Madness has no season range at all, so it accepts exactly
 * what it stores and its wire and stored schemas are the same object rather
 * than a duplicate that could drift.
 */
export const LEAGUE_SETTINGS_INPUT_SCHEMAS = {
  [LEAGUE_MODE.PICKEM]: PickemSettingsInputSchema,
  [LEAGUE_MODE.SURVIVOR]: SurvivorSettingsInputSchema,
  [LEAGUE_MODE.MARCH_MADNESS]: MarchMadnessSettingsSchema,
} as const satisfies Record<LeagueMode, z.ZodType<LeagueSettingsInput, unknown>>;
