import { z } from "@hono/zod-openapi";
import { DisplayNameSchema } from "./display-name";
import { ImageUrlSchema } from "./image-url";
import { UsernameSchema } from "./username";

// mvp-spec §Users & Identity: the authenticated caller's own profile.
// `username` is nullable until claimed at first sign-in. The nullable wrapper
// is registered under its own component name — reusing the registered
// `Username` node here would fold `null` into that shared component and widen
// the (non-nullable) UpdateMeRequest contract too.
const NullableUsernameSchema = UsernameSchema.nullable().openapi("NullableUsername");

// Same registration rule as above: `null` folded into the shared `ImageUrl`
// component would widen every other reference to it.
const NullableImageUrlSchema = ImageUrlSchema.nullable().openapi("NullableImageUrl");

export const MeResponseSchema = z
  .object({
    id: z.string(),
    username: NullableUsernameSchema,
    displayName: z.string(),
    email: z.string(),
    // The *resolved* avatar — the member's override if set, else the
    // provider's (ADR-0022). Not validated as a URL: the provider's string
    // isn't ours to police, and this field is a read.
    image: z.string().nullable(),
    // The member's raw value, carried alongside `image` because the resolved
    // value alone can't distinguish "unset, inheriting the provider's" from
    // "set to that same URL" — so a form round-tripping `image` would promote
    // the provider URL into the override on an untouched save, and clearing
    // would be inexpressible. Only `/me` carries it; every other surface shows
    // other members the resolved value alone.
    imageOverride: NullableImageUrlSchema,
    // Admin capability = the caller's `users.app_role` (ADR-0013) — the SPA uses
    // this to show/hide the admin surface.
    isAdmin: z.boolean(),
    // Whether the simulator exists in this environment (`isSimEnabled`:
    // `SIM_ENABLED` on and not production, ADR-0011/ADR-0014). Served as a typed
    // signal rather than letting the SPA read env vars or infer availability
    // from a 404 on an unregistered route — the sim routes' absence is the
    // actual gate, this only hides the UI.
    simEnabled: z.boolean(),
    /**
     * The application's current time, read from the injected `Clock` (arch
     * D13) — **not** a profile field, and here on purpose.
     *
     * The SPA renders kickoffs relative to now ("Today 1:00 PM", "Sun 8:20
     * PM"), and the browser's own clock is the wrong one to ask: under the
     * simulator it runs at a different instant entirely, so a game the API has
     * already locked would be labelled as kicking off tomorrow. Every derived
     * time in the product comes from this clock, and now the labels do too.
     *
     * Carried on `/me` rather than a `/clock` endpoint of its own because this
     * is the request every authenticated page already makes to bootstrap the
     * session, so the reading costs no extra round trip. The SPA keeps the
     * *offset* from its own clock rather than this instant, so time keeps
     * moving between fetches.
     */
    now: z.iso.datetime(),
  })
  .openapi("MeResponse");

export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * Claiming a username (first sign-in), changing it later (mvp-spec: username
 * is changeable anytime, old name released immediately), and editing the
 * freely-editable display name are all the same partial-update operation —
 * one PATCH /me. At least one field must be present or there's nothing to do.
 *
 * `imageOverride` is tri-state (ADR-0022): absent leaves the stored value
 * alone, an https URL sets it, and an explicit `null` clears it back to the
 * provider's avatar.
 */
export const UpdateMeRequestSchema = z
  .object({
    username: UsernameSchema.optional(),
    displayName: DisplayNameSchema.optional(),
    imageOverride: NullableImageUrlSchema.optional(),
  })
  // Presence, not truthiness: `{ imageOverride: null }` is the clear, and a
  // truthy test would reject the one request whose whole purpose is a falsy
  // value. Unknown keys are stripped before this runs, so a body of only
  // unrecognized fields still fails here.
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one field is required",
  })
  .openapi("UpdateMeRequest");

export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

/**
 * Account deletion (mvp-spec §Users & Identity, ID-3) anonymizes the user row
 * in place rather than removing it — future picks/results/standings FK to it
 * and must survive. This is the single home for the placeholder display name;
 * the API writes it on deletion and future UI (standings, league members)
 * renders deleted users with it.
 */
export const DELETED_USER_DISPLAY_NAME = "Deleted User";
