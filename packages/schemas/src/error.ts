import { z } from "@hono/zod-openapi";

// Shared error envelope for every non-2xx API response (validation failures,
// auth failures, conflicts) — one shape the SPA's error handling can rely on.
export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
  })
  .openapi("ErrorResponse");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
