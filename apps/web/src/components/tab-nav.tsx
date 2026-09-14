import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared underline tab-bar chrome for layout routes whose children are
// sections of one thing (a league, the admin surface). Tabs are real routes,
// not local state, so each section is deep-linkable and survives a refresh —
// callers render `<Link>`s with these props and their own `to`/`params`.
// Real 44px targets keep touch-hit pseudo-elements from extending outside
// the bar and creating vertical scroll overflow on phones. Fitted tabs share
// spare width while retaining enough space for each complete label.
const tabLinkClassName =
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap border-b-2 border-transparent px-1 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:group-data-fit/tabs:grow max-sm:group-data-fit/tabs:px-0";

export const tabLinkProps = {
  className: tabLinkClassName,
  inactiveProps: { className: "text-muted-foreground" },
  activeProps: {
    // Brand underline, foreground text: the orange marks position without
    // recoloring the label (LNCH-9's one signature accent).
    className: cn(tabLinkClassName, "border-primary font-medium text-foreground"),
    "aria-current": "page" as const,
  },
};

/**
 * `fit` keeps every tab visible without a scroll container (MOB-4). Tabs
 * share spare width on phones and wrap if larger text or a narrow viewport
 * needs more room, rather than clipping labels or reducing their size.
 */
export function TabNav({
  label,
  fit = false,
  children,
}: {
  label: string;
  fit?: boolean;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      data-fit={fit || undefined}
      // Sticky beneath the app header, offset by --app-header-height (published
      // by _authed.tsx via ResizeObserver — the header's height varies with
      // SimClockBanner mounting, so it can't be a hardcoded offset). bg-background
      // keeps content from showing through while scrolled under it.
      // Layering: app header z-40 > this tab bar z-30 > page-level fixed
      // elements (AppTabBar, the picks screen's action bar) at z-20.
      className={cn(
        "group/tabs sticky top-[var(--app-header-height,0px)] z-30 flex gap-4 border-b border-border bg-background text-sm select-none",
        fit ? "flex-wrap max-sm:gap-0" : "overflow-x-auto",
      )}
    >
      {children}
    </nav>
  );
}
