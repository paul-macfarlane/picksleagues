import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getProfileByUserId } from "@/data/profiles";
import { auth } from "@/lib/auth";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const profile = await getProfileByUserId(session.user.id);
  if (!profile || !profile.setupComplete) {
    redirect("/profile?setup=true");
  }

  return <>{children}</>;
}
