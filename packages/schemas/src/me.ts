import { z } from "@hono/zod-openapi";
import { UsernameSchema } from "./username";

// mvp-spec §Users & Identity: the authenticated caller's own profile.
// `username` is nullable until claimed at first sign-in. The nullable wrapper
// is registered under its own component name — reusing the registered
// `Username` node here would fold `null` into that shared component and widen
// the (non-nullable) UpdateMeRequest contract too.
const NullableUsernameSchema = UsernameSchema.nullable().openapi("NullableUsername");

export const MeResponseSchema = z
  .object({
    id: z.string(),
    username: NullableUsernameSchema,
    displayName: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  })
  .openapi("MeResponse");

export type MeResponse = z.infer<typeof MeResponseSchema>;

// Claiming a username (first sign-in) and changing it later (mvp-spec: username
// is changeable anytime, old name released immediately) are the same operation —
// one PATCH /me. ID-2 will extend this schema with an optional displayName field.
export const UpdateMeRequestSchema = z
  .object({
    username: UsernameSchema,
  })
  .openapi("UpdateMeRequest");

export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;
