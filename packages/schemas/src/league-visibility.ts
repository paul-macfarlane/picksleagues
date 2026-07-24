import { z } from "@hono/zod-openapi";

/**
 * Private leagues are joinable only via invite link; public leagues also
 * appear in discovery and are joinable directly (spec §Visibility). Invite
 * links work for both — visibility gates discovery, never the join itself.
 */
export const LEAGUE_VISIBILITY = {
  PUBLIC: "public",
  PRIVATE: "private",
} as const;

export type LeagueVisibility = (typeof LEAGUE_VISIBILITY)[keyof typeof LEAGUE_VISIBILITY];

export const LeagueVisibilitySchema = z.enum(LEAGUE_VISIBILITY).openapi("LeagueVisibility");
