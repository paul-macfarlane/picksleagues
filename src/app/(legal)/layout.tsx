import { headers } from "next/headers";

import { AppHeader } from "@/components/app-header";
import { getProfileByUserId } from "@/data/profiles";
import { auth } from "@/lib/auth";

export default async function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    const profile = await getProfileByUserId(session.user.id);
    if (profile?.setupComplete) {
      return (
        <>
          <AppHeader
            user={{ name: profile.name, avatarUrl: profile.avatarUrl }}
          />
          <main className="mx-auto max-w-5xl px-4 py-6 md:px-6">
            {children}
          </main>
        </>
      );
    }
  }

  return <div className="py-12 md:py-20">{children}</div>;
}
