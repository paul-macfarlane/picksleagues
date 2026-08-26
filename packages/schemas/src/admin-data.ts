import { z } from "@hono/zod-openapi";
import { GameStatusSchema, NullableGameStatusSchema } from "./game-status";
import { SportSchema } from "./sport";
import { WeekTypeSchema } from "./week-type";

/**
 * Projections of the provider-synced reference tables for the admin page's
 * data browsers. They are inspection surfaces whose whole point is showing
 * the raw stored truth, so DB columns are serialized flat rather than
 * reshaped; `AdminGame` is the exception and carries provider, override, and
 * resolved values side by side so an operator can see what ingestion wrote,
 * what a human corrected, and what the app will actually use.
 */

export const AdminTeamSchema = z
  .object({
    id: z.string(),
    sport: SportSchema,
    // Null on bootstrap rows that predate provider linkage (see teams table).
    providerTeamId: z.string().nullable(),
    abbreviation: z.string(),
    name: z.string(),
    location: z.string().nullable(),
    logoLightUrl: z.string().nullable(),
    logoDarkUrl: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("AdminTeam");

export type AdminTeam = z.infer<typeof AdminTeamSchema>;

export const AdminTeamsResponseSchema = z
  .object({ teams: z.array(AdminTeamSchema) })
  .openapi("AdminTeamsResponse");

export type AdminTeamsResponse = z.infer<typeof AdminTeamsResponseSchema>;

export const AdminWeekSchema = z
  .object({
    id: z.string(),
    weekType: WeekTypeSchema,
    weekNumber: z.number().int(),
    label: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    // The verification signal the browsers exist for: a synced week with zero
    // games means the schedule sync didn't finish the job.
    gameCount: z.number().int(),
  })
  .openapi("AdminWeek");

export type AdminWeek = z.infer<typeof AdminWeekSchema>;

export const AdminSeasonSchema = z
  .object({
    id: z.string(),
    sport: SportSchema,
    year: z.number().int(),
    provisional: z.boolean(),
    weeks: z.array(AdminWeekSchema),
    /**
     * The season's current week by the app's one definition
     * (`resolveCurrentWeekId`), so admin/sim week selectors can default to it
     * instead of week 1 — advancing the wrong week was a real operator footgun
     * (backlog FB-11). Null when the season has no weeks.
     */
    currentWeekId: z.string().nullable(),
  })
  .openapi("AdminSeason");

export type AdminSeason = z.infer<typeof AdminSeasonSchema>;

export const AdminSeasonsResponseSchema = z
  .object({ seasons: z.array(AdminSeasonSchema) })
  .openapi("AdminSeasonsResponse");

export type AdminSeasonsResponse = z.infer<typeof AdminSeasonsResponseSchema>;

/** A team as the game/stats browsers *label* rows with it — orientation only. */
export const AdminGameTeamSchema = z
  .object({
    id: z.string(),
    abbreviation: z.string(),
    name: z.string(),
  })
  .openapi("AdminGameTeam");

export const AdminGameSchema = z
  .object({
    id: z.string(),
    weekId: z.string(),
    providerGameId: z.string(),
    homeTeam: AdminGameTeamSchema,
    awayTeam: AdminGameTeamSchema,
    // Provider block — exactly what ingestion wrote, never override-resolved,
    // so a browser can prove a re-sync didn't clobber a correction (arch D15).
    kickoffAt: z.iso.datetime(),
    status: GameStatusSchema,
    homeScore: z.number().int().nullable(),
    awayScore: z.number().int().nullable(),
    // Live in-game state as ingestion last saw it (DATA-8): period, and seconds
    // left in it. Null unless the game is in progress.
    period: z.number().int().nullable(),
    clockSeconds: z.number().int().nullable(),
    // Home-team-relative; negative = home favored. Null until the odds sync
    // finds a line for this game.
    spread: z.number().nullable(),
    // Override block — admin corrections only (written by PUT /admin/games/{id}/override).
    overrideKickoffAt: z.iso.datetime().nullable(),
    overrideStatus: NullableGameStatusSchema,
    overrideHomeScore: z.number().int().nullable(),
    overrideAwayScore: z.number().int().nullable(),
    overrideSpread: z.number().nullable(),
    overridePeriod: z.number().int().nullable(),
    overrideClockSeconds: z.number().int().nullable(),
    overriddenBy: z.string().nullable(),
    overriddenAt: z.iso.datetime().nullable(),
    // Resolved block — `override_* ?? provider_*` (arch D15). Serialized rather
    // than left to the client so precedence has one home, not one per consumer.
    effectiveKickoffAt: z.iso.datetime(),
    effectiveStatus: GameStatusSchema,
    effectiveHomeScore: z.number().int().nullable(),
    effectiveAwayScore: z.number().int().nullable(),
    effectiveSpread: z.number().nullable(),
    effectivePeriod: z.number().int().nullable(),
    effectiveClockSeconds: z.number().int().nullable(),
  })
  .openapi("AdminGame");

export type AdminGame = z.infer<typeof AdminGameSchema>;

export const AdminGamesResponseSchema = z
  .object({ games: z.array(AdminGameSchema) })
  .openapi("AdminGamesResponse");

export type AdminGamesResponse = z.infer<typeof AdminGamesResponseSchema>;

// Same bound as the simulator's fixture editor: high enough that no real
// football score is rejected, low enough that a fat-fingered digit is.
const MAX_GAME_SCORE = 200;
// Home-relative points, matching `games.spread`. No real line comes
// near this; the bound exists so a mis-typed or mis-scaled number is refused
// rather than silently regrading every pick on the game.
const MAX_SPREAD = 100;
// A period past regulation is legitimate — overtime keeps counting — so this
// can't be 4; it is high enough that no real game reaches it (the longest NFL
// game ever played ended in the 6th) and low enough to reject a fat-fingered
// digit. Period 0 isn't a period at all: "no period" is expressed by null.
const MAX_PERIOD = 10;
// One hour, against a regulation NFL period of 15 minutes. Generous headroom
// for any other period format, tight enough that a value in milliseconds — or
// minutes mistaken for seconds the other way — is refused rather than stored.
const MAX_CLOCK_SECONDS = 60 * 60;

/**
 * The admin override write (arch §Manual Sports Data Overrides, D15). Fields
 * are unprefixed because the resource *is* the game's override layer — the path
 * says `/override`, and these map 1:1 onto the `override_*` columns, never the
 * provider ones.
 *
 * Three-state per field, which is the whole point of the shape:
 * **omitted** leaves the stored override alone, **null** clears it back to
 * provider truth ("clear override is a null-out", D15), and a value sets it.
 * `.nullable().optional()` is what makes those two distinguishable over JSON —
 * a partial-update body with an explicit null, not a full replacement.
 */
export const GameOverrideRequestSchema = z
  .object({
    kickoffAt: z.iso.datetime().nullable().optional(),
    status: NullableGameStatusSchema.optional(),
    homeScore: z.number().int().min(0).max(MAX_GAME_SCORE).nullable().optional(),
    awayScore: z.number().int().min(0).max(MAX_GAME_SCORE).nullable().optional(),
    spread: z.number().min(-MAX_SPREAD).max(MAX_SPREAD).nullable().optional(),
    period: z.number().int().min(1).max(MAX_PERIOD).nullable().optional(),
    clockSeconds: z.number().int().min(0).max(MAX_CLOCK_SECONDS).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one field is required",
  })
  .openapi("GameOverrideRequest");

export type GameOverrideRequest = z.infer<typeof GameOverrideRequestSchema>;

/**
 * The override write's reply. `resettled` is false when the correction
 * committed but the settlement recompute that follows it (outside the write's
 * transaction, arch D10) threw: results and standings still show the
 * pre-correction grading until the nightly sweep re-derives them. Reporting the
 * whole request as failed instead would be a lie — the write is durable, the
 * operator would be shown stale values, and a retry writes a second audit row.
 */
export const GameOverrideResponseSchema = z
  .object({ game: AdminGameSchema, resettled: z.boolean() })
  .openapi("GameOverrideResponse");

export type GameOverrideResponse = z.infer<typeof GameOverrideResponseSchema>;
