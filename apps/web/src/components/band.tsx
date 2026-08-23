import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The band tier (ADR-0043 §2): the one ink surface on a screen, where the
 * subject being scored is named — the league header, a hub card's strip, the
 * welcome hero. **At most one per screen**; a second band turns the one dark
 * surface from "the subject" into a theme, and the screen is probably two
 * screens (ADR-0043 §Revisit if).
 *
 * The theme tokens are re-pointed for everything inside: `foreground` and
 * `muted-foreground` become the ink pair, and the tag/hairline surfaces
 * (`muted`, `accent`, `border`) lift to `ink-muted`. That is what lets
 * `StatusPill`, `type-eyebrow`, and `text-muted-foreground` render on ink
 * unchanged — a band-specific pill tone or eyebrow would be a second
 * vocabulary to keep in step with the first. Possible only because the theme
 * is `@theme inline`: a utility emits `var(--foreground)` at the use site, so
 * a scoped override wins.
 */
export function Band({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="band"
      className={cn(
        "flex flex-col gap-3 rounded-lg bg-ink px-4 py-4 text-ink-foreground sm:px-5",
        "[--foreground:var(--ink-foreground)] [--muted-foreground:var(--ink-muted-foreground)] [--muted:var(--ink-muted)] [--accent:var(--ink-muted)] [--accent-foreground:var(--ink-foreground)] [--border:var(--ink-muted)]",
        className,
      )}
      {...props}
    />
  );
}
