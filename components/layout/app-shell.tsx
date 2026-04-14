import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { UserMenu } from "@/components/layout/user-menu";

type AppShellUser = {
  name: string;
  email: string;
  image?: string | null;
};

export function AppShell({
  user,
  children,
}: {
  user: AppShellUser;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur">
        <Link
          href="/"
          className="text-base font-bold tracking-tight sm:text-lg"
        >
          PicksLeagues
        </Link>
        <UserMenu user={user} />
      </header>
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
