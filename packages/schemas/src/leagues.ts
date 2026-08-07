import { z } from "@hono/zod-openapi";
import { LEAGUE_MODE, LeagueModeSchema } from "./league-mode";
import {
  EliminationSettingsSchema,
  LeagueSettingsSchema,
  MarchMadnessSettingsSchema,
  PickemSettingsInputSchema,
} from "./league-settings";
import { LeagueStatusSchema } from "./league-status";
import { LeagueVisibilitySchema } from "./league-visibility";
import { MemberRoleSchema } from "./member-role";

/**
 * mvp-spec §Leagues names no length rule for league names; 1-50 trimmed is
 * our chosen sanity bound, mirroring DisplayName.
 */
export const LeagueNameSchema = z.string().trim().min(1).max(50).openapi("LeagueName");

/**
 * spec §Users & Identity Limits: commissioner of at most 10 active leagues,
 * enforced by counted queries inside the create/promote transactions
 * (ADR-0004). Single home so the API guard and UI messaging can't drift.
 */
export const MAX_ACTIVE_COMMISSIONER_LEAGUES = 10;

/**
 * spec §Membership: 2-100 members. The max is enforced in the join
 * transaction; the min is aspirational (a league that never reaches 2 simply
 * proceeds), so only the max is a guard.
 */
export const MAX_LEAGUE_SIZE = 100;

/**
 * spec-adjacent default: a league that omits maxMembers on create gets a
 * friend-group-sized cap rather than the global ceiling.
 */
export const DEFAULT_MAX_MEMBERS = 10;

/**
 * Commissioners may cap their league below the global ceiling (never above
 * it) — mode-agnostic, so it lives beside name/visibility rather than inside
 * any per-mode settings schema.
 */
export const MaxMembersSchema = z.number().int().min(2).max(MAX_LEAGUE_SIZE).openapi("MaxMembers");

/**
 * Settings are validated against the mode's schema at the boundary — the
 * discriminated union makes an invalid mode/settings pairing unrepresentable
 * rather than a service-layer check. Pick'em takes its *input* schema: the
 * request names a season-range preset and the server resolves the week refs it
 * stores (ADR-0020), so a client can't supply them here at all.
 */
export const CreateLeagueRequestSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal(LEAGUE_MODE.PICKEM),
      name: LeagueNameSchema,
      visibility: LeagueVisibilitySchema,
      maxMembers: MaxMembersSchema.default(DEFAULT_MAX_MEMBERS),
      settings: PickemSettingsInputSchema,
    }),
    z.object({
      mode: z.literal(LEAGUE_MODE.ELIMINATION),
      name: LeagueNameSchema,
      visibility: LeagueVisibilitySchema,
      maxMembers: MaxMembersSchema.default(DEFAULT_MAX_MEMBERS),
      settings: EliminationSettingsSchema,
    }),
    z.object({
      mode: z.literal(LEAGUE_MODE.MARCH_MADNESS),
      name: LeagueNameSchema,
      visibility: LeagueVisibilitySchema,
      maxMembers: MaxMembersSchema.default(DEFAULT_MAX_MEMBERS),
      settings: MarchMadnessSettingsSchema,
    }),
  ])
  .openapi("CreateLeagueRequest");

export type CreateLeagueRequest = z.infer<typeof CreateLeagueRequestSchema>;

/**
 * spec §Commissioner Powers: name is cosmetic (anytime); visibility and mode
 * settings lock at league start. `settings` is deliberately unknown here —
 * its schema depends on the league's stored mode, which only the service
 * knows; it validates via LEAGUE_SETTINGS_SCHEMAS and 400s on mismatch.
 */
export const UpdateLeagueRequestSchema = z
  .object({
    name: LeagueNameSchema.optional(),
    visibility: LeagueVisibilitySchema.optional(),
    maxMembers: MaxMembersSchema.optional(),
    settings: z.unknown().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.visibility !== undefined ||
      data.maxMembers !== undefined ||
      data.settings !== undefined,
    { message: "At least one of name, visibility, maxMembers, or settings is required" },
  )
  .openapi("UpdateLeagueRequest");

export type UpdateLeagueRequest = z.infer<typeof UpdateLeagueRequestSchema>;

/**
 * Promote/demote are the same partial update on the membership's role
 * (ADR-0004: transfer = promote + self-demote; no dedicated transfer power).
 */
export const UpdateMemberRoleRequestSchema = z
  .object({ role: MemberRoleSchema })
  .openapi("UpdateMemberRoleRequest");

export type UpdateMemberRoleRequest = z.infer<typeof UpdateMemberRoleRequestSchema>;

export const LeagueMemberSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    // Null for deleted accounts (anonymized in place, ID-3) and never-claimed
    // edge states — render via the shared display-name fallback.
    username: z.string().nullable(),
    displayName: z.string(),
    image: z.string().nullable(),
    role: MemberRoleSchema,
    joinedAt: z.iso.datetime(),
  })
  .openapi("LeagueMember");

export type LeagueMember = z.infer<typeof LeagueMemberSchema>;

/**
 * `startsAt` is the clock-derived league start (first game kickoff of the
 * start week / first R64 tip — arch §Locking Model): null while the schedule
 * for that week hasn't been ingested yet, in which case the league is
 * pre-start. Serialized rather than a boolean so the UI can render countdowns
 * in the user's local timezone.
 */
export const LeagueResponseSchema = z
  .object({
    id: z.string(),
    name: LeagueNameSchema,
    mode: LeagueModeSchema,
    visibility: LeagueVisibilitySchema,
    status: LeagueStatusSchema,
    seasonYear: z.number().int(),
    settings: LeagueSettingsSchema,
    startsAt: z.iso.datetime().nullable(),
    // Server-derived (ADR-0009 "renewal is explicit"): a newer `sport_seasons`
    // row exists for the mode's sport than the current instance is bound to, so
    // a commissioner may mint next season's instance. The window/role gate
    // still lives server-side (RENEW_SEASON is commissioner-only).
    renewable: z.boolean(),
    maxMembers: z.number().int(),
    myRole: MemberRoleSchema,
    members: z.array(LeagueMemberSchema),
  })
  .openapi("LeagueResponse");

export type LeagueResponse = z.infer<typeof LeagueResponseSchema>;

export const LeagueSummarySchema = z
  .object({
    id: z.string(),
    name: LeagueNameSchema,
    mode: LeagueModeSchema,
    visibility: LeagueVisibilitySchema,
    status: LeagueStatusSchema,
    memberCount: z.number().int(),
    maxMembers: z.number().int(),
    myRole: MemberRoleSchema,
    startsAt: z.iso.datetime().nullable(),
    // See LeagueResponse.renewable — drives the dashboard "New season available"
    // badge without an extra per-league fetch.
    renewable: z.boolean(),
  })
  .openapi("LeagueSummary");

export type LeagueSummary = z.infer<typeof LeagueSummarySchema>;

/**
 * Envelope (not a bare array) so list-level fields can be added without a
 * breaking contract change.
 */
export const MyLeaguesResponseSchema = z
  .object({ leagues: z.array(LeagueSummarySchema) })
  .openapi("MyLeaguesResponse");

export type MyLeaguesResponse = z.infer<typeof MyLeaguesResponseSchema>;
