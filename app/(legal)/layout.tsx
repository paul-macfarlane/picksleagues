import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { AppShell } from "@/components/layout/app-shell";
import { SiteFooter } from "@/components/layout/site-footer";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getProfileByUserId } from "@/data/profiles";
import { getSession } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";

export default async function LegalLayout({
  children,
}: {
  children: ReactNode;
}) {
  let session = null;
  try {
    session = await getSession();
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }
  }

  if (session) {
    const profile = await getProfileByUserId(session.user.id);
    if (profile) {
      return (
        <AppShell
          user={{
            name: profile.name,
            email: session.user.email,
            image: profile.avatarUrl,
          }}
        >
          {children}
        </AppShell>
      );
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-14 items-center justify-between px-4">
        <Link href="/" aria-label="PicksLeagues home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 flex-col px-4 py-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
