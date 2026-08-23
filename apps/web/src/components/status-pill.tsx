import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The small caps tag that annotates a card, row, or list item — league
 * visibility, a commissioner marker, a game's lock state, a settled pick's
 * grade. One shape and one type scale for all of them, because they sit beside
 * each other constantly (a pick row can show a grade next to a "no line yet"
 * note) and a pill that is a pixel off reads as a different kind of thing. The
 * shape is the eyebrow's (ADR-0043 §4) so a tag matches the labels it sits
 * beside instead of being the one rounded-full element on a squared screen.
 *
 * Tones are semantic rather than colours, so the achromatic palette can shift
 * without a sweep through every call site. A tone never carries the meaning
 * alone: every caller pairs it with a word, and the ones standing for a real
 * verdict (a pick's grade) add a distinct glyph too, so the distinction
 * survives colour-blindness and greyscale. There is deliberately no
 * primary-tinted tone: orange means "yours to act on" (ADR-0043 §3), and a
 * tag is never that — a caller wanting one gets a compile error, not a pill.
 */
const STATUS_PILL_TONES = {
  neutral: "bg-muted text-muted-foreground",
  highlight: "bg-accent text-accent-foreground",
  // The strongest tone the achromatic palette offers: a game being played, a
  // commissioner, the member's own pick — the tags that must separate from
  // the muted "Locked"s around them.
  strong: "bg-foreground/10 text-foreground",
  success: "bg-success/10 text-success",
  danger: "bg-destructive/10 text-destructive",
} as const;

export type StatusPillTone = keyof typeof STATUS_PILL_TONES;

/**
 * Span props pass through so a caller can put a `data-testid` and the machine
 * value of what the pill is saying on it. A pill's *word* is copy the
 * facelift may reword; the state it stands for is not, and the E2E gate binds to
 * that instead.
 */
export function StatusPill({
  tone = "neutral",
  className,
  children,
  ...props
}: ComponentProps<"span"> & {
  tone?: StatusPillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "type-eyebrow inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5",
        STATUS_PILL_TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
