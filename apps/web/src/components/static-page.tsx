import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand";

/**
 * Shared shell for the public static pages — legal (LNCH-10) and the rules
 * guide (LNCH-1). Outside the authed layout on purpose: a visitor must be
 * able to read these before signing in, so the page brings its own minimal
 * chrome instead of the app shell.
 */
export function StaticPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 py-8 sm:p-6 sm:py-10">
      <Link
        to="/"
        className="flex items-center gap-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <BrandMark className="size-6" />
        Picks Leagues
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </header>
      <div className="flex flex-col gap-6 text-sm leading-relaxed text-foreground [&_h2]:text-base [&_h2]:font-semibold [&_li]:mt-1 [&_section]:flex [&_section]:flex-col [&_section]:gap-2 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
      <footer className="flex gap-4 border-t border-border pt-4 text-sm text-muted-foreground">
        <Link to="/terms" className="hover:text-foreground">
          Terms of Service
        </Link>
        <Link to="/privacy" className="hover:text-foreground">
          Privacy Policy
        </Link>
      </footer>
    </main>
  );
}
