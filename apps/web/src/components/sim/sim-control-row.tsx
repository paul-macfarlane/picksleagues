import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { rowClassName } from "@/components/row";

/**
 * Shared bordered-row chrome for a labelled simulator control (rule of
 * three: the clock card's four adjustment rows plus the reset card's two
 * scope rows all needed this) — mirrors sync-jobs-card.tsx's row without
 * restating it per card.
 */
export function SimControlRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(rowClassName, "flex flex-col gap-2")}>
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
