import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getSession();
  const profile = await getProfileByUserId(session.user.id);
  // Silent redirect — admin panel existence stays hidden from non-admins.
  if (!profile || profile.role !== "admin") {
    redirect("/home");
  }

  return <>{children}</>;
}
