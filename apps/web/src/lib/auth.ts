import { createAuthClient } from "better-auth/react";

// Better Auth ships its own typed client for session/OAuth flows — the sanctioned
// exception to the "generated OpenAPI client only" rule (engineering rules
// §API-first), since the contract client only covers our own domain routes.
// No baseURL override needed: the SPA and API are same-origin (dev proxy + single
// Vercel project in prod), so Better Auth defaults to window.location.origin.
export const authClient = createAuthClient();

export const { useSession } = authClient;
