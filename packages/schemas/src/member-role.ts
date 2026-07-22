import { z } from "@hono/zod-openapi";

/**
 * `league_members.role` is the sole source of commissionership (ADR-0004):
 * a league has one or more commissioners with identical powers and must keep
 * at least one at all times — there is no `commissioner_id` on `leagues`.
 */
export const MEMBER_ROLE = {
  COMMISSIONER: "commissioner",
  MEMBER: "member",
} as const;

export type MemberRole = (typeof MEMBER_ROLE)[keyof typeof MEMBER_ROLE];

export const MemberRoleSchema = z.enum(MEMBER_ROLE).openapi("MemberRole");
