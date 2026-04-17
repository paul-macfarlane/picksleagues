import { z } from "zod";

import { leagueRoleEnum } from "@/lib/db/schema/leagues";

export const INVITE_EXPIRATION_DAYS_MIN = 1;
export const INVITE_EXPIRATION_DAYS_MAX = 30;
export const INVITE_EXPIRATION_DAYS_DEFAULT = 7;

const expirationDaysSchema = z.coerce
  .number({ error: "Expiration is required." })
  .int("Expiration must be a whole number of days.")
  .min(
    INVITE_EXPIRATION_DAYS_MIN,
    `Must be at least ${INVITE_EXPIRATION_DAYS_MIN} day.`,
  )
  .max(
    INVITE_EXPIRATION_DAYS_MAX,
    `Must be at most ${INVITE_EXPIRATION_DAYS_MAX} days.`,
  );

export const createDirectInviteSchema = z.object({
  leagueId: z.string().uuid({ error: "Invalid league id." }),
  inviteeUserId: z.string().min(1, { error: "Select a user to invite." }),
  role: z.enum(leagueRoleEnum.enumValues),
  expirationDays: expirationDaysSchema,
});

export type CreateDirectInviteInput = z.input<typeof createDirectInviteSchema>;
export type CreateDirectInviteOutput = z.output<
  typeof createDirectInviteSchema
>;

export const respondToDirectInviteSchema = z.object({
  inviteId: z.string().uuid({ error: "Invalid invite id." }),
  response: z.enum(["accept", "decline"]),
});

export type RespondToDirectInviteInput = z.input<
  typeof respondToDirectInviteSchema
>;

export const searchProfilesSchema = z.object({
  leagueId: z.string().uuid({ error: "Invalid league id." }),
  query: z.string().trim().min(1).max(100),
});

export type SearchProfilesInput = z.input<typeof searchProfilesSchema>;

export const createLinkInviteSchema = z.object({
  leagueId: z.string().uuid({ error: "Invalid league id." }),
  role: z.enum(leagueRoleEnum.enumValues),
  expirationDays: expirationDaysSchema,
});

export type CreateLinkInviteInput = z.input<typeof createLinkInviteSchema>;
export type CreateLinkInviteOutput = z.output<typeof createLinkInviteSchema>;

export const revokeLinkInviteSchema = z.object({
  inviteId: z.string().uuid({ error: "Invalid invite id." }),
});

export const joinViaLinkSchema = z.object({
  token: z.string().min(1, "Invalid invite link."),
});

export const LEAGUE_ROLE_LABELS: Record<
  (typeof leagueRoleEnum.enumValues)[number],
  string
> = {
  commissioner: "Commissioner",
  member: "Member",
};
