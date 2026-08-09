import { z } from "@hono/zod-openapi";

/**
 * Game-mode discriminator on `leagues`. Adding a mode means a new settings
 * schema + scoring module + pick table (arch D9) — shared tables never fork
 * per mode, so this set only ever grows.
 */
export const LEAGUE_MODE = {
  PICKEM: "pickem",
  SURVIVOR: "survivor",
  MARCH_MADNESS: "march_madness",
} as const;

export type LeagueMode = (typeof LEAGUE_MODE)[keyof typeof LEAGUE_MODE];

export const LeagueModeSchema = z.enum(LEAGUE_MODE).openapi("LeagueMode");

/**
 * Modes a league can currently be created in. March Madness is deliberately
 * absent until epic 07 builds the mode (LNCH-12) — a league created in it
 * would have no bracket, no scoring, and no board. One definition serving
 * both the create form's mode list and `createLeague`'s refusal, so the SPA
 * hiding an option and the server refusing it can never disagree. Lifting
 * the gate is adding the mode here; the settings schema and form stay.
 */
export const OFFERED_LEAGUE_MODES = [LEAGUE_MODE.PICKEM, LEAGUE_MODE.SURVIVOR] as const;
