import { z } from "@hono/zod-openapi";

/**
 * Stored league lifecycle. Deliberately excludes pre/post-start: that boundary
 * is derived from game timestamps + the injected Clock at query time (arch
 * §Locking Model, D11) and must never be stored. `concluded` flips at final
 * settlement (later epics); the 10-active-commissioner cap counts `active`
 * rows only (spec §Users & Identity Limits).
 */
export const LEAGUE_STATUS = {
  ACTIVE: "active",
  CONCLUDED: "concluded",
} as const;

export type LeagueStatus = (typeof LEAGUE_STATUS)[keyof typeof LEAGUE_STATUS];

export const LeagueStatusSchema = z.enum(LEAGUE_STATUS).openapi("LeagueStatus");
