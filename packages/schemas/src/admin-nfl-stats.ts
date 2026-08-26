import { z } from "@hono/zod-openapi";
import { AdminGameTeamSchema } from "./admin-data";
import { NflGameStatsTeamContextSchema } from "./nfl-game-stats";

/**
 * Admin projections of the NFL stats tables (STAT-7): the stored rows exactly
 * as the stats sync wrote them, since the browsers are that sync's
 * verification surface.
 */

export const AdminNflTeamSeasonStatsSchema = z
  .object({
    id: z.string(),
    team: AdminGameTeamSchema,
    seasonYear: z.number().int(),
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
    // The as-of stamp the browser shows, bumped by every sync write.
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

/**
 * One game's stored context: `payload` as the sync wrote it, parsed through
 * the storage schema so additive defaults materialize.
 */
export const AdminNflGameStatContextBlockSchema = z
  .object({
    payload: z.object({
      home: NflGameStatsTeamContextSchema,
      away: NflGameStatsTeamContextSchema,
    }),
    updatedAt: z.iso.datetime(),
  })
  .openapi("AdminNflGameStatContextBlock");

export type AdminNflGameStatContextBlock = z.infer<typeof AdminNflGameStatContextBlockSchema>;

// Registered under its own name — `.nullable()` on an already-registered node
// folds null into the shared component (engineering rules §Contract & codegen).
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
    // orientation only; the games browser is where kickoff itself is inspected.
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
