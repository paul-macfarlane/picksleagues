import { z } from "@hono/zod-openapi";
import { DisplayNameSchema } from "./display-name";
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
    // Admin capability = env-var user-ID allowlist (arch §Overrides), not a
    // role column — the SPA uses this to show/hide the admin surface.
    isAdmin: z.boolean(),
    // Whether the simulator exists in this environment (`APP_ENV !== production`,
    // ADR-0011). Served as a typed signal rather than letting the SPA read env
    // vars or infer availability from a 404 on an unregistered route — the sim
    // routes' absence in prod is the actual gate, this only hides the UI.
    simEnabled: z.boolean(),
  })
  .openapi("MeResponse");

export type MeResponse = z.infer<typeof MeResponseSchema>;

// Claiming a username (first sign-in), changing it later (mvp-spec: username
// is changeable anytime, old name released immediately), and editing the
// freely-editable display name are all the same partial-update operation —
// one PATCH /me. At least one field must be present or there's nothing to do.
export const UpdateMeRequestSchema = z
  .object({
    username: UsernameSchema.optional(),
    displayName: DisplayNameSchema.optional(),
  })
  .refine((data) => data.username !== undefined || data.displayName !== undefined, {
    message: "At least one of username or displayName is required",
  })
  .openapi("UpdateMeRequest");

export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

// Account deletion (mvp-spec §Users & Identity, ID-3) anonymizes the user row
// in place rather than removing it — future picks/results/standings FK to it
// and must survive. This is the single home for the placeholder display name;
// the API writes it on deletion and future UI (standings, league members)
// renders deleted users with it.
export const DELETED_USER_DISPLAY_NAME = "Deleted User";
