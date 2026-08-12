import { z } from "@hono/zod-openapi";
import { LeagueModeSchema } from "./league-mode";
import { LeagueNameSchema } from "./leagues";
import { PickTypeSchema } from "./pick-type";

/**
 * How many entries a discovery page holds. One home, because the number is a
 * contract between the endpoint's slice and the pager the SPA draws from
 * `totalPages` — a second copy would page a list the server didn't cut.
 */
export const DISCOVERY_PAGE_SIZE = 10;

/**
 * The Pick'em settings a prospective member sees before joining (FB-35): the
 * two that decide what the league asks of them every week. Named for its mode
 * per the mode-naming rule — Survivor has no member-facing configurable setting
 * to show, and March Madness gets its own summary when the mode ships.
 *
 * A summary, not the settings blob: this DTO is served to non-members, so
 * anything added here is public by construction and has to be chosen, not
 * forwarded.
 */
export const DiscoveryPickemSettingsSchema = z
  .object({
    pickType: PickTypeSchema,
    picksPerWeek: z.number().int(),
  })
  .openapi("DiscoveryPickemSettings");

export type DiscoveryPickemSettings = z.infer<typeof DiscoveryPickemSettingsSchema>;

// Registered under its own component name — wrapping the registered schema
// inline would fold `null` into the shared component and widen every other
// reference to it.
const NullableDiscoveryPickemSettingsSchema = DiscoveryPickemSettingsSchema.nullable().openapi(
  "NullableDiscoveryPickemSettings",
);

/**
 * spec §Public Discovery (as amended by ADR-0037): a browse list of public
 * leagues that haven't passed their join cutoff — the joinability-relevant
 * subset, plus the per-mode settings summary a member needs to know what they
 * are signing up for. Never the member list.
 */
export const DiscoveryLeagueSchema = z
  .object({
    id: z.string(),
    name: LeagueNameSchema,
    mode: LeagueModeSchema,
    memberCount: z.number().int(),
    // Carried alongside `memberCount` so a card can say "7 of 10": the
    // remaining space is what the default ordering sorts on (ADR-0037), and an
    // order whose key is invisible reads as arbitrary.
    maxMembers: z.number().int(),
    seasonYear: z.number().int(),
    startsAt: z.iso.datetime().nullable(),
    pickemSettings: NullableDiscoveryPickemSettingsSchema,
  })
  .openapi("DiscoveryLeague");

export type DiscoveryLeague = z.infer<typeof DiscoveryLeagueSchema>;

export const DiscoveryResponseSchema = z
  .object({
    leagues: z.array(DiscoveryLeagueSchema),
    // 1-based, echoed back rather than assumed: the server clamps a page past
    // the end, and a pager that trusted its own request would highlight a page
    // the response isn't from.
    page: z.number().int(),
    pageSize: z.number().int(),
    // Total *matching* leagues, after every filter — the pager's own bound, and
    // the only honest input to "no leagues found" vs "no leagues on this page".
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .openapi("DiscoveryResponse");

export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;
