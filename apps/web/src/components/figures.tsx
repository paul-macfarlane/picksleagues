import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Figure {
  label: ReactNode;
  value: ReactNode;
  testId?: string;
}

/**
 * The numeral slot (ADR-0043 §1, `docs/design-system.md` §Type roles): an
 * eyebrow naming the figure with a display numeral directly beneath it, nothing
 * between. One home for every list of them — the viewer's standing in a band,
 * a discovery card's members and spots left, an invite's season and roster —
 * so the gap, the eyebrow, and the numeral's size never drift between the
 * screens a member compares side by side. The numeral paints `foreground`
 * explicitly because the slot often sits inside muted body copy, and a band
 * re-points `foreground` to ink, so the same class is right on both.
 */
export function Figures({
  figures,
  numeralClassName = "text-2xl",
  className,
  ...props
}: Omit<ComponentProps<"dl">, "children"> & {
  figures: readonly Figure[];
  numeralClassName?: string;
}) {
  return (
    <dl className={cn("flex flex-wrap gap-x-5 gap-y-2", className)} {...props}>
      {figures.map((figure, index) => (
        <div key={figure.testId ?? index} className="flex flex-col gap-1">
          <dt className="type-eyebrow">{figure.label}</dt>
          <dd
            className={cn("type-display text-foreground", numeralClassName)}
            data-testid={figure.testId}
          >
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
