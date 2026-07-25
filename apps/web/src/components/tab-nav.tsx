import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared underline tab-bar chrome for layout routes whose children are
// sections of one thing (a league, the admin surface). Tabs are real routes,
// not local state, so each section is deep-linkable and survives a refresh —
// callers render `<Link>`s with these props and their own `to`/`params`.
const tabLinkClassName =
  "border-b-2 border-transparent px-1 pb-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export const tabLinkProps = {
  className: tabLinkClassName,
  inactiveProps: { className: "text-muted-foreground" },
  activeProps: {
    className: cn(tabLinkClassName, "border-foreground font-medium text-foreground"),
    "aria-current": "page" as const,
  },
};

export function TabNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav
      aria-label={label}
      // Scrolls rather than wraps: the admin bar is five tabs wide at phone
      // width, and a wrapped second row reads as a separate control.
      className="flex gap-4 overflow-x-auto border-b border-border text-sm"
    >
      {children}
    </nav>
  );
}
