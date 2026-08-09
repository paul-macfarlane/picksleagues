import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The a11y wrapper every skeleton region shares (LNCH-8): a grey box says
 * nothing to a screen reader where the "Loading…" sentence did, so a region
 * announces itself with `role="status"` and a label. Shapes stay at the call
 * site — the placeholder must be shaped like the content on its way
 * (engineering rules §Quality), and only the call site knows that shape.
 */
export function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  );
}

/** Card-grid placeholder shaped like the dashboard/discovery league grids. */
export function CardGridSkeleton({ label, cards = 3 }: { label: string; cards?: number }) {
  return (
    <LoadingRegion label={label} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cards }, (_unused, index) => (
        <Skeleton key={index} className="h-44 w-full" />
      ))}
    </LoadingRegion>
  );
}

/** Stacked-row placeholder for lists and tables. */
export function RowsSkeleton({
  label,
  rows = 4,
  rowClassName = "h-10 w-full",
  className,
}: {
  label: string;
  rows?: number;
  rowClassName?: string;
  className?: string;
}) {
  return (
    <LoadingRegion label={label} className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_unused, index) => (
        <Skeleton key={index} className={rowClassName} />
      ))}
    </LoadingRegion>
  );
}

/**
 * Whole-page placeholder for the layout routes (league/admin/sim): a heading
 * or header card, the tab bar, and a section block — the shell the gated page
 * renders around its outlet, so the chrome doesn't jump when the gate opens.
 */
export function PageSkeleton({
  label,
  headerClassName = "h-8 w-40",
}: {
  label: string;
  headerClassName?: string;
}) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-4">
      <Skeleton className={headerClassName} />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-64 w-full" />
    </LoadingRegion>
  );
}
