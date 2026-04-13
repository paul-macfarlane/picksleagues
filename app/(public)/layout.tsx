import Link from "next/link";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-14 items-center justify-between px-4">
        <Link
          href="/"
          className="text-base font-bold tracking-tight sm:text-lg"
        >
          PicksLeagues
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-6">
        {children}
      </main>
    </div>
  );
}
