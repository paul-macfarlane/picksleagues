import type { ReactNode } from "react";

/**
 * Clearing padding for the sheet whose last rows would otherwise sit under
 * `PickSheetActionBar`: the bar's own height plus the safe-area inset the
 * bar pads by, since the inset makes the bar taller by exactly that much.
 */
export const pickSheetActionBarClearanceClassName = "pb-[calc(6rem+env(safe-area-inset-bottom))]";

/**
 * The bottom-anchored action bar both pick sheets end in (feedback:
 * submitting a 16-game slate shouldn't require scrolling to the bottom to
 * find the button). `fixed`, not CSS `sticky` — Card sets `overflow-hidden`
 * for its rounded corners, and any ancestor with overflow other than visible
 * clips/breaks a sticky descendant, whereas `fixed` escapes ancestor layout
 * entirely and anchors straight to the viewport, which is what we want since
 * the document is the app's only scroll container (no ancestor sets a
 * transform/filter that would trap it). z-20 stays under the tab bar (z-30)
 * and header (z-40) per app-header.tsx's layering comment, and well under
 * overlay portals (z-50).
 *
 * Pads by the safe-area insets so the home indicator never overlaps the
 * buttons in the installed app (MOB-1); a sheet rendering this clears it
 * with `pickSheetActionBarClearanceClassName`. MOB-2's tab bar stacks under
 * this bar, never hides it (owner, 2026-08-22) — its offset lands here.
 */
export function PickSheetActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur">
      {/* Stacks at phone width: the status line and the buttons each need a
          line of their own at 375px. Above `sm` there is room for one line. */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {children}
      </div>
    </div>
  );
}
