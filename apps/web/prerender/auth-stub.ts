/**
 * Stands in for `src/lib/auth.ts` during the prerender build (aliased in
 * `vite.config.ts`), which is the whole reason the public routes can render
 * under Node at all: the real client resolves its base URL from
 * `window.location.origin`, so `getSession()` fetches a relative path that
 * Node can't parse and the route falls into its error boundary — a page that
 * "renders" as the words "Something went wrong!".
 *
 * Returning no session is the correct answer, not a convenience: a prerendered
 * document is served to everyone, so the only view it may ever hold is the one
 * a signed-out visitor sees.
 */

const noSession = { data: null, error: null } as const;

export const authClient = {
  getSession: async () => noSession,
  useSession: () => noSession,
  signIn: { social: async () => noSession },
  signOut: async () => noSession,
};

export const useSession = authClient.useSession;
