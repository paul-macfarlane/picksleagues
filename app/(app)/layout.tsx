import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";

export default async function AppLayout({ children }: { children: ReactNode }) {
  let session;
  try {
    session = await getSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }
    throw error;
  }

  const profile = await getProfileByUserId(session.user.id);
  if (!profile) {
    redirect("/login");
  }

  if (!profile.setupComplete) {
    redirect("/setup");
  }

  return (
    <AppShell
      user={{
        name: profile.name,
        email: session.user.email,
        image: profile.avatarUrl,
        isAdmin: profile.role === "admin",
      }}
    >
      {children}
    </AppShell>
  );
}
