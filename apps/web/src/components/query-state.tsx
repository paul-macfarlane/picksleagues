import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shared loading/error/empty triad for any query-backed view: originally a
 * rule-of-three extraction for the admin browsers (teams/seasons/games),
 * since adopted by the league pick'em/standings screens too — one definition
 * for the "Loading… / error + outline Retry / empty" markup instead of every
 * screen re-hand-rolling it (and silently drifting, as the picks tab's
 * missing Retry did before this extraction).
 */
export function QueryState({
  isPending,
  pendingFallback,
  isError,
  onRetry,
  errorMessage,
  isEmpty,
  emptyMessage,
  children,
}: {
  isPending: boolean;
  /**
   * Skeletons shaped like the content on its way, so the layout doesn't jump
   * when data lands (engineering rules §Quality). Required — LNCH-8 retired
   * the "Loading…" text form, and a required prop is what keeps the next view
   * from reintroducing it. Wrap it in `LoadingRegion` (or otherwise give it
   * `role="status"` and a label): a grey box says nothing to a screen reader
   * where a sentence did.
   */
  pendingFallback: ReactNode;
  isError: boolean;
  onRetry: () => void;
  errorMessage: string;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}) {
  if (isPending) {
    return <>{pendingFallback}</>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (isEmpty) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return <>{children}</>;
}
