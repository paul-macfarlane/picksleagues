import { useEffect, useRef, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

/**
 * Refresh policy (MOB-5): the gesture invalidates with no key filter (owner,
 * 2026-08-23) — only the queries the current view holds active actually
 * refetch, which is exactly "refresh what I'm looking at", and a per-route
 * key registry would be one more thing a new route forgets to join. No key
 * literals exist here to drift. The native browser gesture this stands in
 * for is already disabled by MOB-1's `overscroll-behavior-y: none`, so the
 * two never fight.
 */

// Raw finger travel is damped so the chip trails the gesture (feels attached,
// not 1:1), and the trigger sits far enough that an idle top-of-page tap
// can't fire it.
const PULL_DAMPING = 2.5;
const PULL_TRIGGER_PX = 56;
const PULL_MAX_PX = 72;

const dampedPull = (delta: number) => Math.min(delta / PULL_DAMPING, PULL_MAX_PX);

/**
 * Pull-to-refresh for every query-backed view (MOB-5): a downward drag that
 * starts with the page scrolled to the top invalidates queries and shows a
 * spinner until the active ones settle.
 *
 * Mount exactly once, in the authed shell — the listeners are window-level,
 * so a second mount would double-fire every refresh. Touch-only by
 * construction (no pointer fallback): a desktop reader has a reload key.
 */
export function PullToRefresh() {
  const queryClient = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  // Mirror of `refreshing` so the passive touchstart listener can read the
  // in-flight status without living in the effect's dependency list.
  const refreshingRef = useRef(false);

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (refreshingRef.current || !touch || event.touches.length !== 1 || window.scrollY > 0)
        return;
      // A gesture on a portaled overlay (dialog, sheet, menu — all render as
      // siblings of #root) belongs to that surface: a drag on a bottom-sheet
      // confirm must not refetch the page behind it.
      if (!(event.target instanceof Element) || !event.target.closest("#root")) return;
      startY.current = touch.clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const touch = event.touches[0];
      // The page took the gesture as a scroll, or a second finger landed —
      // stand down for this touch.
      if (!touch || window.scrollY > 0 || event.touches.length !== 1) {
        startY.current = null;
        setPull(0);
        return;
      }
      const delta = touch.clientY - startY.current;
      setPull(delta <= 0 ? 0 : dampedPull(delta));
    };

    const onTouchEnd = (event: TouchEvent) => {
      // A finger remains (a stray second finger's lift is not the release).
      if (startY.current === null || event.touches.length > 0) return;
      const touch = event.changedTouches[0];
      const released = touch ? dampedPull(touch.clientY - startY.current) : 0;
      startY.current = null;
      setPull(0);
      if (released >= PULL_TRIGGER_PX) {
        refreshingRef.current = true;
        setRefreshing(true);
        // Resolves when the refetches it started settle, so the spinner's
        // lifetime is the honest "still refreshing" signal.
        void queryClient.invalidateQueries().finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
        });
      }
    };

    const onTouchCancel = () => {
      // The OS took the gesture away (notification banner, edge gesture):
      // discard it — only a release the member completed may refresh.
      startY.current = null;
      setPull(0);
    };

    // Passive throughout: nothing here scrolls the page or needs to cancel
    // the browser's handling, so the listeners must not tax scrolling.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [queryClient]);

  const progress = Math.min(pull / PULL_TRIGGER_PX, 1);

  return (
    // Header tier (z-40): the chip floats over content and the sticky TabNav
    // (z-30) it would otherwise slide behind. The status region stays mounted
    // and announces via text content: a live region inserted already-populated
    // is generally not read, and `aria-label` changes never announce.
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--app-header-height,0px)+0.75rem)] z-40 flex justify-center"
    >
      <span className="sr-only">{refreshing ? "Refreshing" : ""}</span>
      {(refreshing || pull > 0) && (
        <div
          aria-hidden="true"
          className={cn(
            "flex size-9 items-center justify-center rounded-full border bg-background shadow-sm",
            !refreshing && "transition-opacity",
          )}
          style={
            refreshing
              ? undefined
              : { opacity: 0.3 + progress * 0.7, transform: `rotate(${progress * 180}deg)` }
          }
        >
          <RefreshCwIcon
            aria-hidden="true"
            className={cn("size-4 text-muted-foreground", refreshing && "animate-spin")}
          />
        </div>
      )}
    </div>
  );
}
