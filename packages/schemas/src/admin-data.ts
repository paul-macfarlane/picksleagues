import { z } from "@hono/zod-openapi";
import { GameStatusSchema } from "./game-status";
import { SportSchema } from "./sport";
import { WeekTypeSchema } from "./week-type";

/**
 * Projections of the provider-synced reference tables for the admin page's
 * data browsers. They are inspection surfaces whose whole point is showing
 * the raw stored truth, so DB columns are serialized flat rather than
 * reshaped. The provider's value is the only value (ADR-0046): what ingestion
 * wrote is what the app uses.
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
  })
  .openapi("AdminGame");

export type AdminGame = z.infer<typeof AdminGameSchema>;

export const AdminGamesResponseSchema = z
  .object({ games: z.array(AdminGameSchema) })
  .openapi("AdminGamesResponse");

export type AdminGamesResponse = z.infer<typeof AdminGamesResponseSchema>;
