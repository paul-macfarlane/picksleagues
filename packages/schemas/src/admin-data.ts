import { z } from "@hono/zod-openapi";
import { GameStatusSchema } from "./game-status";
import { SportSchema } from "./sport";
import { WeekTypeSchema } from "./week-type";

/**
 * Read-only projections of the provider-synced reference tables for the admin
 * page's data browsers (arch §Manual Sports Data Overrides: "read-only
 * browsers over reference data — teams, seasons/weeks, games, odds
 * snapshots"). These are inspection surfaces whose whole point is showing the
 * raw stored truth, so DB columns are serialized flat rather than reshaped;
 * `AdminGame` is the exception and carries provider, override, and resolved
 * values side by side so an operator can see what ingestion wrote, what a human
 * corrected, and what the app will actually use.
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
  })
  .openapi("AdminSeason");

export type AdminSeason = z.infer<typeof AdminSeasonSchema>;

export const AdminSeasonsResponseSchema = z
  .object({ seasons: z.array(AdminSeasonSchema) })
  .openapi("AdminSeasonsResponse");

export type AdminSeasonsResponse = z.infer<typeof AdminSeasonsResponseSchema>;

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
    // Latest odds snapshot for this game; null until the odds sync captures one.
    latestSpread: z.number().nullable(),
    latestSpreadCapturedAt: z.iso.datetime().nullable(),
    // Override block — admin corrections only (ADM-2 writes these).
    overrideKickoffAt: z.iso.datetime().nullable(),
    overrideStatus: GameStatusSchema.nullable(),
    overrideHomeScore: z.number().int().nullable(),
    overrideAwayScore: z.number().int().nullable(),
    overrideSpread: z.number().nullable(),
    overriddenBy: z.string().nullable(),
    overriddenAt: z.iso.datetime().nullable(),
    // Resolved block — `override_* ?? provider_*` (arch D15). Serialized rather
    // than left to the client so precedence has one home, not one per consumer.
    effectiveKickoffAt: z.iso.datetime(),
    effectiveStatus: GameStatusSchema,
    effectiveHomeScore: z.number().int().nullable(),
    effectiveAwayScore: z.number().int().nullable(),
    effectiveSpread: z.number().nullable(),
  })
  .openapi("AdminGame");

export type AdminGame = z.infer<typeof AdminGameSchema>;

export const AdminGamesResponseSchema = z
  .object({ games: z.array(AdminGameSchema) })
  .openapi("AdminGamesResponse");

export type AdminGamesResponse = z.infer<typeof AdminGamesResponseSchema>;

export const AdminOddsSnapshotSchema = z
  .object({
    id: z.string(),
    // Home-team-relative; negative = home favored (odds_snapshots.spread).
    spread: z.number(),
    capturedAt: z.iso.datetime(),
  })
  .openapi("AdminOddsSnapshot");

export type AdminOddsSnapshot = z.infer<typeof AdminOddsSnapshotSchema>;

// Snapshot history is unbounded over a season of 5-minute odds syncs, so the
// browser reads the most recent page only — enough to see whether the spread is
// moving and when it was last captured.
export const ADMIN_ODDS_SNAPSHOT_LIMIT = 50;

export const AdminGameOddsResponseSchema = z
  .object({ snapshots: z.array(AdminOddsSnapshotSchema) })
  .openapi("AdminGameOddsResponse");

export type AdminGameOddsResponse = z.infer<typeof AdminGameOddsResponseSchema>;
