import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { getProfileByUserId, insertProfile } from "@/data/profiles";
import { db } from "@/lib/db";
import { UnauthorizedError } from "@/lib/errors";
import { generateUsername } from "@/lib/username";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const username = generateUsername(user.email);
          await insertProfile({
            userId: user.id,
            username,
            name: user.name || "New User",
            avatarUrl: user.image ?? null,
            setupComplete: false,
          });
        },
      },
    },
  },
});

type AuthenticatedSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

export async function getSession(): Promise<AuthenticatedSession> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  return session;
}

export async function redirectIfAuthenticated(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return;

  const profile = await getProfileByUserId(session.user.id);
  if (!profile || !profile.setupComplete) {
    redirect("/profile?setup=true");
  }
  redirect("/home");
}
