import type { ReactNode } from "react";
import { AppBottomBarActions } from "@/components/app-bottom-bar";

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
 * Both pick sheets keep their actions in the shell's fixed `AppBottomBar`:
 * one viewport anchor prevents a scroll-time seam above mobile navigation.
 * The portal retains the route's React context and removes its controls on
 * unmount. Navigation owns the mobile safe area; this bar pads it only from
 * `sm` up, where navigation is hidden. Clear the sheet's last rows with
 * `pickSheetActionBarClearanceClassName`.
 */
export function PickSheetActionBar({ children }: { children: ReactNode }) {
  return (
    <AppBottomBarActions>
      <div className="border-t border-border bg-background pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] sm:pb-[env(safe-area-inset-bottom)]">
        {/* Stacks at phone width: the status line and the buttons each need a
          line of their own at 375px. Above `sm` there is room for one line. */}
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {children}
        </div>
      </div>
    </AppBottomBarActions>
  );
}
