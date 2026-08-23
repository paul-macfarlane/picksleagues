import type { ReactNode } from "react";

/**
 * Clearing padding for the sheet whose last rows would otherwise sit under
 * `PickSheetActionBar`: the bar's own height plus whatever it stands on —
 * below `sm` the tab bar (whose published height already includes the
 * safe-area inset), above it the inset alone, since that is what makes the
 * bar taller there.
 */
export const pickSheetActionBarClearanceClassName =
  "pb-[calc(6rem+var(--app-tab-bar-height,0px))] sm:pb-[calc(6rem+env(safe-area-inset-bottom))]";

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
 * Stands on `AppTabBar` below `sm` (`bottom: var(--app-tab-bar-height)`)
 * rather than hiding it — navigation that vanishes when picks are dirty
 * confuses more than it frees (owner, 2026-08-22). The tab bar already pads
 * the bottom safe-area inset, so this bar pads it only from `sm` up, where it
 * sits on the viewport edge itself (MOB-1); a sheet rendering this clears it
 * with `pickSheetActionBarClearanceClassName`.
 */
export function PickSheetActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[var(--app-tab-bar-height,0px)] z-20 border-t border-border bg-background/95 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] backdrop-blur sm:pb-[env(safe-area-inset-bottom)]">
      {/* Stacks at phone width: the status line and the buttons each need a
          line of their own at 375px. Above `sm` there is room for one line. */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {children}
      </div>
    </div>
  );
}
