import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared underline tab-bar chrome for layout routes whose children are
// sections of one thing (a league, the admin surface). Tabs are real routes,
// not local state, so each section is deep-linkable and survives a refresh —
// callers render `<Link>`s with these props and their own `to`/`params`.
// `shrink-0 whitespace-nowrap` is what actually makes a scrolling bar scroll:
// without them a flex item compresses to fit and wraps its own label, so a
// two-word tab stacked into two lines and doubled the bar's height instead
// of overflowing it. Every tab was one word until it wasn't.
//
// The `group-data-fit/tabs` variants are the phone-width `fit` layout (see
// TabNav): equal columns, centred, one size down. They live here rather than
// on a second props object because every tab is written `{...tabLinkProps}`
// and the bar, not the tab, knows which layout it's in.
const tabLinkClassName =
  "touch-hit shrink-0 whitespace-nowrap border-b-2 border-transparent px-1 pb-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:group-data-fit/tabs:flex-1 max-sm:group-data-fit/tabs:px-0 max-sm:group-data-fit/tabs:text-center max-sm:group-data-fit/tabs:text-xs";

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
 * `fit` — below `sm`, the tabs share the width as equal columns instead of
 * scrolling (MOB-4, owner: horizontal scroll in a nav feels unnatural on a
 * phone). Only for bars whose labels all fit at 375px: the league bar's five
 * do, the admin bar's seven can't, so operator bars keep scrolling.
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
      // Scrolls rather than wraps: the admin bar is five tabs wide at phone
      // width, and a wrapped second row reads as a separate control.
      className="group/tabs sticky top-[var(--app-header-height,0px)] z-30 flex gap-4 overflow-x-auto border-b border-border bg-background text-sm select-none max-sm:data-fit:gap-0"
    >
      {children}
    </nav>
  );
}
