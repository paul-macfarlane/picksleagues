import { useEffect, useRef, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

/**
 * Pull-to-refresh for every query-backed view (MOB-5): a downward drag that
 * starts with the page scrolled to the top invalidates queries and shows a
 * spinner until the active ones settle. Mounted once in the authed shell —
 * refresh is a property of the app, not of any one route.
 *
 * It invalidates with no key filter (owner, 2026-08-23): only the queries the
 * current view holds active actually refetch, which is exactly "refresh what
 * I'm looking at" — and a per-route key registry would be one more thing a
 * new route forgets to join. No key literals exist here to drift.
 *
 * Touch-only by construction (no pointer fallback): a desktop reader has a
 * reload key. The native browser gesture this stands in for is already
 * disabled by MOB-1's `overscroll-behavior-y: none`, so the two never fight.
 */

// Raw finger travel is damped so the chip trails the gesture (feels attached,
// not 1:1), and the trigger sits far enough that an idle top-of-page tap
// can't fire it.
const PULL_DAMPING = 2.5;
const PULL_TRIGGER_PX = 56;
const PULL_MAX_PX = 72;

export function PullToRefresh() {
  const queryClient = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  // Mirrors of the two states, so the handlers read the current values
  // without living in the effect's dependency list — and so touchend never
  // branches inside a state updater, which StrictMode may run twice.
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const updatePull = (px: number) => {
      pullRef.current = px;
      setPull(px);
    };

    const onTouchStart = (event: TouchEvent) => {
      // Arm only for a single finger resting on an unscrolled page; a
      // mid-page touch or a pinch is never a refresh.
      const touch = event.touches[0];
      if (refreshingRef.current || !touch || event.touches.length !== 1 || window.scrollY > 0)
        return;
      startY.current = touch.clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const touch = event.touches[0];
      // The page took the gesture as a scroll — stand down for this touch.
      if (!touch || window.scrollY > 0 || event.touches.length !== 1) {
        startY.current = null;
        updatePull(0);
        return;
      }
      const delta = touch.clientY - startY.current;
      updatePull(delta <= 0 ? 0 : Math.min(delta / PULL_DAMPING, PULL_MAX_PX));
    };

    const onTouchEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      const released = pullRef.current;
      updatePull(0);
      if (released >= PULL_TRIGGER_PX && !refreshingRef.current) {
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

    // Passive throughout: nothing here scrolls the page or needs to cancel
    // the browser's handling, so the listeners must not tax scrolling.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [queryClient]);

  const visible = refreshing || pull > 0;
  if (!visible) return null;

  const progress = Math.min(pull / PULL_TRIGGER_PX, 1);

  return (
    <div
      role="status"
      aria-label={refreshing ? "Refreshing" : "Pull to refresh"}
      // Header tier (z-40): the chip floats over content and the sticky
      // TabNav (z-30) it would otherwise slide behind.
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--app-header-height,0px)+0.75rem)] z-40 flex justify-center"
    >
      <div
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
    </div>
  );
}
