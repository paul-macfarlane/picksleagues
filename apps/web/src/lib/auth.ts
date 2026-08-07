import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

/**
 * Better Auth ships its own typed client for session/OAuth flows — the sanctioned
 * exception to the "generated OpenAPI client only" rule (engineering rules
 * §API-first), since the contract client only covers our own domain routes.
 * No baseURL override needed: the SPA and API are same-origin (dev proxy + single
 * Vercel project in prod), so Better Auth defaults to window.location.origin.
 */
export const authClient = createAuthClient({
  plugins: [
    // Must mirror the server's `user.additionalFields` in apps/api/src/auth.ts —
    // that's the only way `session.user.username` is typed (and present) here.
    inferAdditionalFields({
      user: { username: { type: "string", required: false } },
    }),
  ],
});

export const { useSession } = authClient;
