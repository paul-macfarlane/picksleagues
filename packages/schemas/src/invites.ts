import { z } from "@hono/zod-openapi";
import { LeagueModeSchema } from "./league-mode";
import { LeagueNameSchema } from "./leagues";
import { LeagueVisibilitySchema } from "./league-visibility";

// spec §Invites: expiry and max-use are both optional; a bare invite never
// expires and has unlimited uses. Revocation is the only other lifecycle.
export const CreateInviteRequestSchema = z
  .object({
    expiresAt: z.iso.datetime().optional(),
    maxUses: z.number().int().min(1).max(1000).optional(),
  })
  .openapi("CreateInviteRequest");

export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>;

/**
 * Derived, never stored — computed from (revokedAt, expiresAt, useCount,
 * maxUses) against the injected Clock at serialization time, same pattern as
 * lock state (arch D11).
 */
export const INVITE_STATUS = {
  ACTIVE: "active",
  REVOKED: "revoked",
  EXPIRED: "expired",
  EXHAUSTED: "exhausted",
} as const;

export type InviteStatus = (typeof INVITE_STATUS)[keyof typeof INVITE_STATUS];

export const InviteStatusSchema = z.enum(INVITE_STATUS).openapi("InviteStatus");

export const InviteSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    status: InviteStatusSchema,
    expiresAt: z.iso.datetime().nullable(),
    maxUses: z.number().int().nullable(),
    useCount: z.number().int(),
    revokedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    // Null when the creating commissioner's account was deleted (FK set null).
    createdBy: z
      .object({
        userId: z.string(),
        username: z.string().nullable(),
        displayName: z.string(),
      })
      .nullable(),
  })
  .openapi("LeagueInvite");

export type Invite = z.infer<typeof InviteSchema>;

export const InvitesResponseSchema = z
  .object({ invites: z.array(InviteSchema) })
  .openapi("InvitesResponse");

export type InvitesResponse = z.infer<typeof InvitesResponseSchema>;

/**
 * Why a join would be refused, in precedence order: invite validity
 * (revoked/expired/exhausted), then the caller's own membership, then league
 * lifecycle, then the clock-derived cutoff, then capacity. The preview and
 * the join endpoint share this set so the join screen can explain the exact
 * refusal the POST would produce.
 */
export const JOIN_BLOCKED_REASON = {
  INVITE_REVOKED: "invite_revoked",
  INVITE_EXPIRED: "invite_expired",
  INVITE_EXHAUSTED: "invite_exhausted",
  ALREADY_MEMBER: "already_member",
  LEAGUE_CONCLUDED: "league_concluded",
  JOIN_CLOSED: "join_closed",
  LEAGUE_FULL: "league_full",
} as const;

export type JoinBlockedReason = (typeof JOIN_BLOCKED_REASON)[keyof typeof JOIN_BLOCKED_REASON];

export const JoinBlockedReasonSchema = z.enum(JOIN_BLOCKED_REASON).openapi("JoinBlockedReason");

// One home for refusal copy so the API's 409 message and the join screen's
// pre-flight explanation can't drift.
export const JOIN_BLOCKED_REASON_MESSAGES: Record<JoinBlockedReason, string> = {
  [JOIN_BLOCKED_REASON.INVITE_REVOKED]: "That invite link has been revoked.",
  [JOIN_BLOCKED_REASON.INVITE_EXPIRED]: "That invite link has expired.",
  [JOIN_BLOCKED_REASON.INVITE_EXHAUSTED]: "That invite link has reached its use limit.",
  [JOIN_BLOCKED_REASON.ALREADY_MEMBER]: "You're already a member of this league.",
  [JOIN_BLOCKED_REASON.LEAGUE_CONCLUDED]: "This league has concluded.",
  [JOIN_BLOCKED_REASON.JOIN_CLOSED]: "This league has started — joining is closed.",
  [JOIN_BLOCKED_REASON.LEAGUE_FULL]: "This league is full.",
};

// The subset of league fields a prospective member may see before joining —
// mirrors what a public discovery entry shows (spec §Public Discovery), never
// the member list.
export const JoinPreviewResponseSchema = z
  .object({
    league: z.object({
      id: z.string(),
      name: LeagueNameSchema,
      mode: LeagueModeSchema,
      visibility: LeagueVisibilitySchema,
      memberCount: z.number().int(),
      seasonYear: z.number().int(),
      startsAt: z.iso.datetime().nullable(),
    }),
    joinable: z.boolean(),
    reason: JoinBlockedReasonSchema.nullable(),
  })
  .openapi("JoinPreviewResponse");

export type JoinPreviewResponse = z.infer<typeof JoinPreviewResponseSchema>;
