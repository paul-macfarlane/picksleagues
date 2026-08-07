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
