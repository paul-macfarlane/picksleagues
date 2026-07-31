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
