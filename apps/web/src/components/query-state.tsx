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
  pendingMessage = "Loading…",
  pendingFallback,
  isError,
  onRetry,
  errorMessage,
  isEmpty,
  emptyMessage,
  children,
}: {
  isPending: boolean;
  pendingMessage?: string;
  /**
   * Skeletons shaped like the content on its way, rendered instead of the
   * pending line — so the layout doesn't jump when data lands (engineering
   * rules §Quality). Pass one; the message form is what the views predating
   * that rule still fall back to. Whatever is passed must announce itself
   * (`role="status"` and a label): a grey box says nothing to a screen reader
   * where the sentence did.
   */
  pendingFallback?: ReactNode;
  isError: boolean;
  onRetry: () => void;
  errorMessage: string;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}) {
  if (isPending) {
    if (pendingFallback) return <>{pendingFallback}</>;
    return <p className="py-8 text-center text-sm text-muted-foreground">{pendingMessage}</p>;
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
