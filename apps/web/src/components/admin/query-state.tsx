import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// Shared loading/error/empty triad for the admin page's read-only browsers
// (rule of three: the teams, seasons, and games browsers all needed this) —
// mirrors the discovery page's idiom (centered py-8, outline Retry button)
// without restating it per browser.
export function AdminQueryState({
  isPending,
  isError,
  onRetry,
  errorMessage,
  isEmpty,
  emptyMessage,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  errorMessage: string;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}) {
  if (isPending) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
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
