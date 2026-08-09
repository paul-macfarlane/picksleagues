import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { BrandMark } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { LegalFooter } from "@/components/legal-footer";

/**
 * Shared shell for the public static pages — legal (LNCH-10) and the rules
 * guide (LNCH-1). Outside the authed layout on purpose (a visitor must be
 * able to read these before signing in), but not outside the app's chrome:
 * a signed-in member gets the real AppHeader so the way back into the app is
 * the same one every other page has, and a visitor gets a slim bar that
 * routes to the splash and sign-in.
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
  const { data: session } = authClient.useSession();
  // Same bar as pre-claim: AppHeader's nav points into the authed subtree,
  // which the username gate would bounce a pre-claim session straight out of.
  const authed = Boolean(session?.user.username);

  return (
    <div className="flex min-h-svh flex-col">
      {authed ? <AppHeader /> : <VisitorHeader />}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 py-8 sm:p-6 sm:py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </header>
        <div className="flex flex-col gap-6 text-sm leading-relaxed text-foreground [&_h2]:text-base [&_h2]:font-semibold [&_li]:mt-1 [&_section]:flex [&_section]:flex-col [&_section]:gap-2 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <LegalFooter className="mx-auto w-full max-w-2xl px-4 sm:px-6" />
    </div>
  );
}

function VisitorHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <Link
          to="/welcome"
          className="flex items-center gap-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <BrandMark className="size-6" />
          Picks Leagues
        </Link>
        <Link to="/sign-in" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Sign in
        </Link>
      </div>
    </header>
  );
}
