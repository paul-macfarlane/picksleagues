import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The section tier (ADR-0043 §2), and the default grouping on every screen:
 * an eyebrow, a heading, a description, and an action slot, separated from
 * its neighbours by whitespace alone. No border and no fill on purpose — a
 * bordered grouping at every level is what left the league header, its week,
 * and each game inside it wearing the same chrome, so the eye had nesting
 * where it needed hierarchy. A thing that is an *object* (a league in a list,
 * a dialog-like form) is a panel (`Card`) instead; `docs/design-system.md`
 * names which tier to reach for.
 *
 * The title is a real `h2` (the base layer gives it the heading role), so a
 * screen's sections are its outline for a screen reader; a section with no
 * title renders no header at all. Element props pass through so a caller can
 * put a `data-testid` on the section the way it did on the card it replaces.
 */
export function Section({
  eyebrow,
  title,
  description,
  action,
  className,
  children,
  ...props
  // `title` shadows the native tooltip attribute on purpose: a section's title is
  // its heading, and a hover tooltip restating it is nothing anyone wants.
}: Omit<ComponentProps<"section">, "title"> & {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const titleId = useId();
  const hasHeader = eyebrow || title || description || action;
  return (
    <section
      data-slot="section"
      aria-labelledby={title ? titleId : undefined}
      className={cn("flex flex-col gap-3", className)}
      {...props}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            {eyebrow && <p className="type-eyebrow">{eyebrow}</p>}
            {title && (
              <h2 id={titleId} className="text-base leading-snug">
                {title}
              </h2>
            )}
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
