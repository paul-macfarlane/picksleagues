import { z } from "@hono/zod-openapi";
import { LEAGUE_MODE, LeagueModeSchema } from "./league-mode";
import {
  SurvivorSettingsInputSchema,
  LeagueSettingsSchema,
  MarchMadnessSettingsSchema,
  PickemSettingsInputSchema,
} from "./league-settings";
import { LeagueStatusSchema } from "./league-status";
import { LeagueVisibilitySchema } from "./league-visibility";
import { MemberRoleSchema } from "./member-role";
import { NullablePickemPickStatusSchema, NullablePickemViewerStandingSchema } from "./pickem";
import { NullableSurvivorPickStatusSchema, NullableSurvivorViewerStandingSchema } from "./survivor";

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
 * rather than a service-layer check. Both NFL modes take their *input* schema:
 * neither request carries week refs, because the server resolves the range it
 * stores — each mode's one legal range is the regular season (ADR-0024,
 * ADR-0031).
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
      mode: z.literal(LEAGUE_MODE.SURVIVOR),
      name: LeagueNameSchema,
      visibility: LeagueVisibilitySchema,
      maxMembers: MaxMembersSchema.default(DEFAULT_MAX_MEMBERS),
      settings: SurvivorSettingsInputSchema,
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
    /**
     * When a commissioner marked this member's dues paid; null = unpaid.
     * Serialized to every member — "everyone sees who's paid" is the product
     * rule (ADR-0045), so this is deliberately not commissioner-scoped.
     * Meaningless (always null-or-stale) while the league's `duesAmount` is
     * null; the UI renders no dues surface then.
     */
    duesPaidAt: z.iso.datetime().nullable(),
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
    /**
     * Whole dollars per member for the current season instance; null = this
     * league doesn't track dues (ADR-0045) and no dues surface renders.
     * Mode-agnostic, so it sits beside maxMembers rather than inside the
     * per-mode settings.
     */
    duesAmount: z.number().int().nullable(),
    myRole: MemberRoleSchema,
    members: z.array(LeagueMemberSchema),
    /**
     * The viewer's place in the league, one field per mode and null on a
     * league of another mode (the per-mode naming rule; see `LeagueSummary`
     * for why both DTOs carry it). Serialized pre-start too — a new member's
     * zero line is a fact (spec §Edge Cases) — and the SPA decides whether a
     * league that hasn't kicked off shows it, from the same clock every other
     * pre-start label reads.
     */
    myPickemStanding: NullablePickemViewerStandingSchema,
    mySurvivorStanding: NullableSurvivorViewerStandingSchema,
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
    /**
     * The label of the week the league is on right now ("Week 5", "Wild Card"),
     * server-resolved so the card names the same week the pick screen it links
     * to does. Null for a mode with no season range and before a season's weeks
     * are ingested.
     *
     * Carried alongside `startsAt` rather than replacing it because the card
     * needs both: a league that hasn't started is described by when it will,
     * and one that has is described by where it is — a card still announcing a
     * start date the season is months past is what this field exists to fix
     * (FB-28).
     */
    currentWeekLabel: z.string().nullable(),
    // See LeagueResponse.renewable — drives the dashboard "New season available"
    // badge without an extra per-league fetch.
    renewable: z.boolean(),
    /**
     * The viewer's own week at a glance (spec §Screens — Dashboard), one field
     * per mode and null on every league of another mode. Named for their modes
     * because each is shaped by its own: one changeable pick per week is
     * Survivor's rule, N picks in a single irreversible submission is Pick'em's
     * (ADR-0018), and an unqualified `pickStatus` would have to widen to hold
     * both plus whatever March Madness needs.
     *
     * Both are viewer-scoped, which is safe only because this schema is reached
     * solely through `MyLeaguesResponse` — public discovery serializes its own
     * shape. Anything added here inherits that scoping.
     */
    survivorPickStatus: NullableSurvivorPickStatusSchema,
    pickemPickStatus: NullablePickemPickStatusSchema,
    /**
     * The season the current instance is bound to (ADR-0009), so a card's
     * eyebrow reads "NFL Pick'em · 2026" in the same shape as the league header.
     */
    seasonYear: z.number().int(),
    /**
     * The viewer's standing at a glance, beside the pick status: the rank and
     * record (Pick'em) or alive-or-out and who is left (Survivor) that the hub
     * card shows as its numerals. Same viewer scoping as the glances above.
     */
    myPickemStanding: NullablePickemViewerStandingSchema,
    mySurvivorStanding: NullableSurvivorViewerStandingSchema,
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
