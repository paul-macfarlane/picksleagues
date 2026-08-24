import type { BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createDb } from "../../packages/db/src/client";
import { loadEnv } from "../../packages/core/src/env";
import { createAuth } from "../../apps/api/src/auth";
import { createAuthenticatedUser } from "../../apps/api/test/setup/auth-helpers";
import type { AppRole } from "../../packages/schemas/src/app-role";
import { loadE2eEnv } from "./e2e-env";

// Bare specifiers like "better-auth" or "@picksleagues/db" only resolve from
// inside the package that actually declares them as a dependency — pnpm gives
// each workspace package its own node_modules rather than hoisting to the
// repo root, and Node resolves a bare import relative to the *importing
// file's* location, not the entrypoint's. e2e/ declares none of these deps
// itself, so every import above is a relative path into apps/api or
// packages/{db,core}'s own source — each of those files' own bare imports
// then resolve against the node_modules colocated with *them*.
const SESSION_COOKIE_NAME = "better-auth.session_token";

// The root .env with the E2E overrides applied — the same values
// playwright.config.ts hands the API server it starts, so a minted cookie
// authenticates against the exact server a spec's `page.goto` will hit, and
// against the E2E database rather than the dev one. Runs once per worker
// process at module load.
loadE2eEnv();

const env = loadEnv(process.env);
const db = createDb(env.DATABASE_URL);
const auth = createAuth({ env, db });

export type MintedUser = Awaited<ReturnType<typeof createAuthenticatedUser>>["user"];

export type MintedSession = {
  user: MintedUser;
  // Shaped for `context.addCookies`, which stores whatever `value` it's given
  // byte-for-byte and hands it back verbatim in the `Cookie` header (Chromium
  // does no transcoding at that layer — confirmed empirically against a local
  // echo server). `createAuthenticatedUser`'s cookie string is
  // `name=<percent-encoded value>` (the same shape a real Set-Cookie would
  // produce); decode it here so `addCookies` is given the logical cookie
  // value rather than its wire-encoded representation.
  cookieForPlaywright: { name: string; value: string; domain: string; path: string };
};

export async function mintSession(
  overrides: {
    email?: string;
    displayName?: string;
    username?: string | null;
    appRole?: AppRole;
  } = {},
): Promise<MintedSession> {
  const { appRole, ...profileOverrides } = overrides;
  const { user, cookie } = await createAuthenticatedUser(auth, profileOverrides);
  const rawValue = cookie.slice(`${SESSION_COOKIE_NAME}=`.length);

  // The whole reason app-wide admin capability is a column rather than config
  // (ADR-0013): the dev API read its env long before this user existed, so only
  // a runtime grant can make a minted user an admin. Written directly (not
  // through Better Auth) because Better Auth has no `additionalFields` entry for
  // `app_role` — nothing in it touches the column.
  if (appRole !== undefined) {
    await db.$client.query("UPDATE users SET app_role = $1 WHERE id = $2", [appRole, user.id]);
  }

  return {
    user,
    cookieForPlaywright: {
      name: SESSION_COOKIE_NAME,
      value: decodeURIComponent(rawValue),
      domain: "localhost",
      path: "/",
    },
  };
}

/**
 * Mints a session and drops it straight into the browser's cookie jar — every
 * spec authenticates this way instead of driving real OAuth (there's no
 * headless IdP to drive; see e2e/smoke.spec.ts).
 */
export async function signInAs(
  context: BrowserContext,
  overrides?: Parameters<typeof mintSession>[0],
): Promise<MintedUser> {
  const { user, cookieForPlaywright } = await mintSession(overrides);
  await context.addCookies([cookieForPlaywright]);
  return user;
}

/**
 * Specs must remove what they create — the E2E database persists between runs
 * rather than being torn down after each. Cascades to sessions/accounts (FK
 * ON DELETE CASCADE), including the anonymized row left behind by a delete-
 * account spec, which by design survives the API call itself.
 */
export async function cleanup(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await db.$client.query("DELETE FROM users WHERE id = ANY($1::text[])", [userIds]);
}

/**
 * 3-20 chars, [a-z0-9_] (packages/schemas' UsernameSchema) with enough entropy
 * to never collide across a parallel run — randomUUID's hyphens aren't legal
 * in a username, so strip them. (randomUUID over Date.now() because a whole
 * parallel worker batch can mint within the same millisecond.)
 */
export function uniqueUsername(): string {
  return `u_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
