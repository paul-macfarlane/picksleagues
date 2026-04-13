import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
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

  return (
    <AppShell
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
    >
      {children}
    </AppShell>
  );
}
