import { z } from "@hono/zod-openapi";

// mvp-spec §Users & Identity: 3-20 chars, letters/numbers/underscores, stored
// and compared lowercase (case-insensitive uniqueness backed by DB citext).
// The single source for this rule — served to both the API and the UI.
export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9_]{3,20}$/,
    "Username must be 3-20 characters and contain only letters, numbers, and underscores",
  )
  .openapi("Username");

export type Username = z.infer<typeof UsernameSchema>;
