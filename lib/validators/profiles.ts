import { z } from "zod";

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(50, "Username must be at most 50 characters.")
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Username may only contain letters, numbers, underscores, and hyphens.",
  )
  .refine((v) => v.toLowerCase() !== "anonymous", {
    message: 'The username "anonymous" is reserved.',
  });

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(100, "Name must be at most 100 characters.");

const avatarUrlSchema = z
  .union([
    z.string().trim().url("Avatar URL must be a valid URL.").max(2048),
    z.literal(""),
  ])
  .optional();

export const updateProfileSchema = z.object({
  username: usernameSchema,
  name: nameSchema,
  avatarUrl: avatarUrlSchema,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
