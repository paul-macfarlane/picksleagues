"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type LeagueTab = {
  label: string;
  href: string;
};

function buildTabs(leagueId: string): LeagueTab[] {
  return [
    { label: "Standings", href: `/leagues/${leagueId}` },
    { label: "My Picks", href: `/leagues/${leagueId}/my-picks` },
    { label: "League Picks", href: `/leagues/${leagueId}/league-picks` },
    { label: "Members", href: `/leagues/${leagueId}/members` },
    { label: "Settings", href: `/leagues/${leagueId}/settings` },
  ];
}

export function LeagueTabs({ leagueId }: { leagueId: string }) {
  const pathname = usePathname();
  const tabs = buildTabs(leagueId);

  return (
    <nav
      aria-label="League sections"
      className="-mx-4 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex gap-1">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap rounded-t-md border-b-2 px-3 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href.endsWith("/my-picks")) return pathname.startsWith(href);
  if (href.endsWith("/league-picks")) return pathname.startsWith(href);
  if (href.endsWith("/members")) return pathname.startsWith(href);
  if (href.endsWith("/settings")) return pathname.startsWith(href);
  // Standings is the root — only active when nothing deeper is selected.
  return pathname === href;
}
