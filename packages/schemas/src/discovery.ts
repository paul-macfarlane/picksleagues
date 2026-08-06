import { z } from "@hono/zod-openapi";
import { LeagueModeSchema } from "./league-mode";
import { LeagueNameSchema } from "./leagues";

/**
 * spec §Public Discovery: a browse list of public leagues that haven't passed
 * their join cutoff — no filters/categories/recommendations, so the shape is
 * deliberately the same joinability-relevant subset JoinPreviewResponse shows
 * (name, mode, member count, start, joinable), minus visibility (implied —
 * every entry here is public) and minus members/settings (never shown
 * pre-join).
 */
export const DiscoveryLeagueSchema = z
  .object({
    id: z.string(),
    name: LeagueNameSchema,
    mode: LeagueModeSchema,
    memberCount: z.number().int(),
    seasonYear: z.number().int(),
    startsAt: z.iso.datetime().nullable(),
  })
  .openapi("DiscoveryLeague");

export type DiscoveryLeague = z.infer<typeof DiscoveryLeagueSchema>;

export const DiscoveryResponseSchema = z
  .object({ leagues: z.array(DiscoveryLeagueSchema) })
  .openapi("DiscoveryResponse");

export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;
