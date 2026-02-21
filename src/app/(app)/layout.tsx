import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { getProfileByUserId } from "@/data/profiles";
import { auth } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const profile = await getProfileByUserId(session.user.id);
  const showHeader = profile?.setupComplete;

  return (
    <>
      {showHeader && (
        <AppHeader
          user={{ name: profile.name, avatarUrl: profile.avatarUrl }}
        />
      )}
      <main className="mx-auto max-w-5xl px-4 py-6 md:px-6">{children}</main>
    </>
  );
}
