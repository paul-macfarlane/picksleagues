import { z } from "@hono/zod-openapi";
import { LeagueModeSchema } from "./league-mode";
import { LeagueNameSchema } from "./leagues";
import { LeagueVisibilitySchema } from "./league-visibility";

/**
 * An invite is a bare opaque code (spec §Invites, ADR-0032): no expiry, no
 * use cap, no create-time options at all. Revocation is its only lifecycle,
 * and it carries no wire status: both serialization paths — creation, and a
 * list that filters revoked rows out — can only ever emit a live invite, so
 * a status field would be a constant.
 */
export const InviteSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    useCount: z.number().int(),
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
 * (revoked), then the caller's own membership, then league lifecycle, then
 * the clock-derived cutoff, then capacity. The preview and the join endpoint
 * share this set so the join screen can explain the exact refusal the POST
 * would produce.
 */
export const JOIN_BLOCKED_REASON = {
  INVITE_REVOKED: "invite_revoked",
  ALREADY_MEMBER: "already_member",
  LEAGUE_CONCLUDED: "league_concluded",
  JOIN_CLOSED: "join_closed",
  LEAGUE_FULL: "league_full",
} as const;

export type JoinBlockedReason = (typeof JOIN_BLOCKED_REASON)[keyof typeof JOIN_BLOCKED_REASON];

export const JoinBlockedReasonSchema = z.enum(JOIN_BLOCKED_REASON).openapi("JoinBlockedReason");

/**
 * One home for refusal copy so the API's 409 message and the join screen's
 * pre-flight explanation can't drift.
 */
export const JOIN_BLOCKED_REASON_MESSAGES: Record<JoinBlockedReason, string> = {
  [JOIN_BLOCKED_REASON.INVITE_REVOKED]: "That invite link has been revoked.",
  [JOIN_BLOCKED_REASON.ALREADY_MEMBER]: "You're already a member of this league.",
  [JOIN_BLOCKED_REASON.LEAGUE_CONCLUDED]: "This league has concluded.",
  [JOIN_BLOCKED_REASON.JOIN_CLOSED]: "This league has started — joining is closed.",
  [JOIN_BLOCKED_REASON.LEAGUE_FULL]: "This league is full.",
};

/**
 * The subset of league fields a prospective member may see before joining —
 * mirrors what a public discovery entry shows (spec §Public Discovery), never
 * the member list.
 */
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
