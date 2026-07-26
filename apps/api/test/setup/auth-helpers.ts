import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, type Db } from "@picksleagues/db";
import { APP_ROLE } from "@picksleagues/schemas";
import type { Auth } from "../../src/auth";

const SESSION_COOKIE_NAME = "better-auth.session_token";

/**
 * Better Auth's session cookie is `${token}.${signature}` (URL-encoded),
 * where `signature` is a *standard*-alphabet (`+`/`/`, padded) base64 of
 * HMAC-SHA256(secret, token) — see better-call's `crypto.ts`
 * (`makeSignature`/`verifySignature`, used by `getSignedCookie`). This is
 * NOT what `@better-auth/utils/hmac`'s `createHMAC(..., "base64")` produces:
 * despite the name, that helper's "base64"/"base64url"/"base64urlnopad"
 * modes all use the url-safe alphabet, so its output fails better-call's
 * `atob`-based verification. Node's `createHmac(...).digest("base64")` uses
 * the standard alphabet and matches byte-for-byte, so we use that instead of
 * reimplementing HMAC.
 */
function signSessionToken(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return `${token}.${signature}`;
}

/**
 * Creates a user + session directly through Better Auth's internal adapter
 * (bypassing OAuth) and returns the `Cookie` header value that authenticates
 * as that user. Shared by any integration test that needs an authenticated
 * request — reuse this rather than re-deriving session cookies per test.
 */
export async function createAuthenticatedUser(
  auth: Auth,
  overrides: { email?: string; displayName?: string; username?: string | null } = {},
) {
  const ctx = await auth.$context;
  // Better Auth's canonical user field is `name`; `user.fields.name: "display_name"`
  // (apps/api/src/auth.ts) remaps it to the physical column at the adapter layer.
  const user = await ctx.internalAdapter.createUser({
    email: overrides.email ?? `user-${randomUUID()}@example.com`,
    name: overrides.displayName ?? "Test User",
    ...(overrides.username !== undefined ? { username: overrides.username } : {}),
  });
  const session = await ctx.internalAdapter.createSession(user.id);
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signSessionToken(session.token, ctx.secret))}`;
  return { user, session, cookie };
}

/**
 * Grants app-wide admin capability the only way the app supports it: writing
 * `users.app_role`, the sole authorization source (ADR-0013). Mirrors the
 * one-line UPDATE an operator runs against a real environment.
 */
export async function grantAdmin(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ appRole: APP_ROLE.ADMIN }).where(eq(users.id, userId));
}
