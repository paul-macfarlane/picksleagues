import { z } from "zod";

export const UpdateProfileSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be at most 50 characters")
    .refine((val) => val.toLowerCase() !== "anonymous", {
      message: 'The username "anonymous" is reserved',
    }),
  name: z.string().min(1, "Name is required"),
  avatarUrl: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  isSetup: z.boolean().optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
