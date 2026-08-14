import { z } from "@hono/zod-openapi";
import { AdminGameTeamSchema } from "./admin-data";
import {
  NflGameStatContextOverridePayloadSchema,
  NflGameStatsTeamContextSchema,
} from "./nfl-game-stats";

/**
 * Admin projections and override writes for the NFL stats tables (STAT-7,
 * ADR-0041 — amending ADR-0040's original no-overrides decision). Same
 * three-block shape as `AdminGame`: provider values exactly as ingestion wrote
 * them, the override layer, and the resolved `override_* ?? provider_*` values
 * the member surface serves — side by side so an operator can prove a re-sync
 * didn't clobber a correction (arch D15).
 */

// An NFL team plays at most ~21 games a season (17 regular + postseason); the
// bound exists so a fat-fingered third digit is refused, not to model the
// schedule.
const MAX_SEASON_GAMES = 30;
// Signed, like the stored column: +N winning streak, -N losing.
const MAX_STREAK = MAX_SEASON_GAMES;
// Real season points-for tops out in the 600s; a 4-digit typo is refused.
const MAX_SEASON_POINTS = 1000;

const countField = z.number().int().min(0).max(MAX_SEASON_GAMES).nullable().optional();
const pointsField = z.number().int().min(0).max(MAX_SEASON_POINTS).nullable().optional();

/**
 * Three-state patch onto the `override_*` columns, exactly the
 * `GameOverrideRequest` contract: **omitted** leaves the stored override
 * alone, **null** clears it back to provider truth, a value sets it
 * (arch D15).
 */
export const NflTeamSeasonStatsOverrideRequestSchema = z
  .object({
    wins: countField,
    losses: countField,
    ties: countField,
    homeWins: countField,
    homeLosses: countField,
    homeTies: countField,
    roadWins: countField,
    roadLosses: countField,
    roadTies: countField,
    streak: z.number().int().min(-MAX_STREAK).max(MAX_STREAK).nullable().optional(),
    pointsFor: pointsField,
    pointsAgainst: pointsField,
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one field is required",
  })
  .openapi("NflTeamSeasonStatsOverrideRequest");

export type NflTeamSeasonStatsOverrideRequest = z.infer<
  typeof NflTeamSeasonStatsOverrideRequestSchema
>;

export const AdminNflTeamSeasonStatsSchema = z
  .object({
    id: z.string(),
    team: AdminGameTeamSchema,
    seasonYear: z.number().int(),
    // Provider block — exactly what the stats sync wrote.
    wins: z.number().int(),
    losses: z.number().int(),
    ties: z.number().int(),
    homeWins: z.number().int(),
    homeLosses: z.number().int(),
    homeTies: z.number().int(),
    roadWins: z.number().int(),
    roadLosses: z.number().int(),
    roadTies: z.number().int(),
    streak: z.number().int(),
    pointsFor: z.number().int(),
    pointsAgainst: z.number().int(),
    // Override block — admin corrections only (PUT /admin/nfl-stats/{id}/override).
    overrideWins: z.number().int().nullable(),
    overrideLosses: z.number().int().nullable(),
    overrideTies: z.number().int().nullable(),
    overrideHomeWins: z.number().int().nullable(),
    overrideHomeLosses: z.number().int().nullable(),
    overrideHomeTies: z.number().int().nullable(),
    overrideRoadWins: z.number().int().nullable(),
    overrideRoadLosses: z.number().int().nullable(),
    overrideRoadTies: z.number().int().nullable(),
    overrideStreak: z.number().int().nullable(),
    overridePointsFor: z.number().int().nullable(),
    overridePointsAgainst: z.number().int().nullable(),
    overriddenBy: z.string().nullable(),
    overriddenAt: z.iso.datetime().nullable(),
    // Resolved block — `override_* ?? provider_*`, serialized rather than left
    // to the client so precedence has one home (arch D15).
    effectiveWins: z.number().int(),
    effectiveLosses: z.number().int(),
    effectiveTies: z.number().int(),
    effectiveHomeWins: z.number().int(),
    effectiveHomeLosses: z.number().int(),
    effectiveHomeTies: z.number().int(),
    effectiveRoadWins: z.number().int(),
    effectiveRoadLosses: z.number().int(),
    effectiveRoadTies: z.number().int(),
    effectiveStreak: z.number().int(),
    effectivePointsFor: z.number().int(),
    effectivePointsAgainst: z.number().int(),
    // The as-of stamp the browser shows — bumped by sync writes and override
    // writes alike, so it always dates the row as the member surface serves it.
    updatedAt: z.iso.datetime(),
  })
  .openapi("AdminNflTeamSeasonStats");

export type AdminNflTeamSeasonStats = z.infer<typeof AdminNflTeamSeasonStatsSchema>;

/**
 * The season-stats browser's page: every stored season year (the selector's
 * options), the year actually served (defaulted server-side to the newest so
 * the browser opens on something useful), and that season's rows. `seasonYear`
 * is null exactly when the table is empty.
 */
export const AdminNflTeamSeasonStatsResponseSchema = z
  .object({
    seasonYears: z.array(z.number().int()),
    seasonYear: z.number().int().nullable(),
    stats: z.array(AdminNflTeamSeasonStatsSchema),
  })
  .openapi("AdminNflTeamSeasonStatsResponse");

export type AdminNflTeamSeasonStatsResponse = z.infer<typeof AdminNflTeamSeasonStatsResponseSchema>;

export const NflTeamSeasonStatsOverrideResponseSchema = z
  .object({ stats: AdminNflTeamSeasonStatsSchema })
  .openapi("NflTeamSeasonStatsOverrideResponse");

export type NflTeamSeasonStatsOverrideResponse = z.infer<
  typeof NflTeamSeasonStatsOverrideResponseSchema
>;

/**
 * The override write for a game's context layer. PUT-replace rather than the
 * three-state patch the column tables use: the override layer here is one
 * JSONB value, so the natural write is "this is the whole correction now" —
 * an absent field carries no override, and an empty body clears the layer
 * entirely (stored as NULL, indistinguishable from never corrected, arch D15).
 */
export const NflGameStatContextOverrideRequestSchema =
  NflGameStatContextOverridePayloadSchema.openapi("NflGameStatContextOverrideRequest");

export type NflGameStatContextOverrideRequest = z.infer<
  typeof NflGameStatContextOverrideRequestSchema
>;

// Registered under its own name — `.nullable()` on an already-registered node
// folds null into the shared component (engineering rules §Contract & codegen).
const NullableNflGameStatContextOverridePayloadSchema =
  NflGameStatContextOverridePayloadSchema.nullable().openapi(
    "NullableNflGameStatContextOverridePayload",
  );

/**
 * One game's stored context with all three layers: `payload` as the sync wrote
 * it (parsed through the storage schema so additive defaults materialize),
 * the sparse override layer, and the field-level `override ?? provider`
 * resolution the member sheet serves.
 */
export const AdminNflGameStatContextBlockSchema = z
  .object({
    payload: z.object({
      home: NflGameStatsTeamContextSchema,
      away: NflGameStatsTeamContextSchema,
    }),
    overridePayload: NullableNflGameStatContextOverridePayloadSchema,
    effective: z.object({
      home: NflGameStatsTeamContextSchema,
      away: NflGameStatsTeamContextSchema,
    }),
    overriddenBy: z.string().nullable(),
    overriddenAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("AdminNflGameStatContextBlock");

export type AdminNflGameStatContextBlock = z.infer<typeof AdminNflGameStatContextBlockSchema>;

const NullableAdminNflGameStatContextBlockSchema =
  AdminNflGameStatContextBlockSchema.nullable().openapi("NullableAdminNflGameStatContextBlock");

/**
 * One game row of the context browser. `context` null means the stats sync
 * has not reached this game — shown, not hidden, because "a synced week with a
 * context gap" is exactly the verification signal the browsers exist for.
 */
export const AdminNflGameStatContextSchema = z
  .object({
    gameId: z.string(),
    homeTeam: AdminGameTeamSchema,
    awayTeam: AdminGameTeamSchema,
    // The *resolved* kickoff (`override_kickoff_at ?? kickoff_at`, arch D15) —
    // orientation only; the games browser is where kickoff itself is
    // inspected and corrected, layer by layer.
    kickoffAt: z.iso.datetime(),
    context: NullableAdminNflGameStatContextBlockSchema,
  })
  .openapi("AdminNflGameStatContext");

export type AdminNflGameStatContext = z.infer<typeof AdminNflGameStatContextSchema>;

export const AdminNflGameStatContextsResponseSchema = z
  .object({ games: z.array(AdminNflGameStatContextSchema) })
  .openapi("AdminNflGameStatContextsResponse");

export type AdminNflGameStatContextsResponse = z.infer<
  typeof AdminNflGameStatContextsResponseSchema
>;

export const NflGameStatContextOverrideResponseSchema = z
  .object({ game: AdminNflGameStatContextSchema })
  .openapi("NflGameStatContextOverrideResponse");

export type NflGameStatContextOverrideResponse = z.infer<
  typeof NflGameStatContextOverrideResponseSchema
>;
