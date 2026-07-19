import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "@picksleagues/db";
import { accounts, sessions, users, verifications } from "@picksleagues/db";
import type { Env } from "@picksleagues/core";

/**
 * Google/Discord OAuth with cookie sessions (mvp-spec §Users & Identity: no
 * email/password, no email sending). `name` is remapped to `display_name`
 * (provider-prefilled, freely editable) and `username` is exposed as a
 * read-only additional field — it's nullable until claimed at first sign-in
 * by a separate endpoint (`input: false` keeps Better Auth's own sign-up/
 * update-user routes from writing it directly).
 */
export function createAuth({ env, db }: { env: Env; db: Db }) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { users, sessions, accounts, verifications },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
      discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
      },
    },
    user: {
      modelName: "users",
      fields: { name: "display_name" },
      additionalFields: {
        username: { type: "string", required: false, input: false },
      },
    },
    session: { modelName: "sessions" },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
  });
}

export type Auth = ReturnType<typeof createAuth>;
