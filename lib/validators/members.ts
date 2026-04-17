import { z } from "zod";

const userIdSchema = z.string().min(1, { error: "Missing user id." });
const leagueIdSchema = z.string().uuid({ error: "Invalid league id." });

export const promoteMemberSchema = z.object({
  leagueId: leagueIdSchema,
  userId: userIdSchema,
});

export const demoteMemberSchema = z.object({
  leagueId: leagueIdSchema,
  userId: userIdSchema,
});

export const removeMemberSchema = z.object({
  leagueId: leagueIdSchema,
  userId: userIdSchema,
});
