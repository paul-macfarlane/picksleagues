import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The app's one pager. Callback-driven rather than shadcn's anchor-composition
 * flavor because both call sites already own where a page lives — discovery in
 * a search param, the audit log in route state — and an `href`-based API would
 * make each of them rebuild the same URL twice.
 *
 * A single component rather than composable parts for the same reason a second
 * hand-rolled table is a problem: prev/next affordances, the current-page
 * marker, and the truncation rule are decisions that must not drift between two
 * lists a member can visit in the same session.
 */

// Which page buttons a pager shows, with `null` marking a truncated run.
function pageItems(page: number, totalPages: number): (number | null)[] {
  // Every page fits before truncation earns its place; at friends scale this is
  // nearly always the branch taken.
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const window = [page - 1, page, page + 1].filter((n) => n > 1 && n < totalPages);
  const items: (number | null)[] = [1];
  if ((window[0] ?? totalPages) > 2) items.push(null);
  items.push(...window);
  if ((window[window.length - 1] ?? 1) < totalPages - 1) items.push(null);
  items.push(totalPages);
  return items;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  // One page is not a choice, and a pager rendered for it is chrome that only
  // ever reads as disabled.
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-center gap-1", className)}
    >
      <Button
        variant="outline"
        size="sm"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
        <span className="hidden sm:inline">Previous</span>
      </Button>
      {pageItems(page, totalPages).map((item, index) =>
        item === null ? (
          // Decorative: the pages it stands for are reachable by stepping, and
          // announcing "ellipsis" between two page numbers tells a screen
          // reader nothing it can act on.
          <span
            key={`gap-${index}`}
            aria-hidden="true"
            className="px-1 text-sm text-muted-foreground"
          >
            …
          </span>
        ) : (
          <Button
            key={item}
            variant={item === page ? "default" : "ghost"}
            size="sm"
            // The name has to carry the word "page": a button labelled "3"
            // announces as "3", which says nothing about what it does.
            aria-label={`Page ${item}`}
            aria-current={item === page ? "page" : undefined}
            onClick={() => onPageChange(item)}
          >
            {item}
          </Button>
        ),
      )}
      <Button
        variant="outline"
        size="sm"
        aria-label="Next page"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </nav>
  );
}
