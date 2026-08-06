import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The small rounded label that annotates a card, row, or list item — league
 * visibility, a commissioner marker, a game's lock state, a settled pick's
 * grade. One shape and one type scale for all of them, because they sit beside
 * each other constantly (a pick row can show a grade next to a "no line yet"
 * note) and a pill that is a pixel off reads as a different kind of thing.
 *
 * Tones are semantic rather than colours, so the achromatic palette can shift
 * without a sweep through every call site. A tone never carries the meaning
 * alone: every caller pairs it with a word, and the ones standing for a real
 * verdict (a pick's grade) add a distinct glyph too, so the distinction
 * survives colour-blindness and greyscale.
 */
const STATUS_PILL_TONES = {
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-primary/10 text-primary",
  highlight: "bg-accent text-accent-foreground",
  // Reserved for a game actually being played: the strongest tone the
  // achromatic palette offers, so a live row separates from both the muted
  // "Locked" pills around it and the primary-tinted ones on picks that can
  // still be changed.
  strong: "bg-foreground/10 text-foreground",
  success: "bg-success/10 text-success",
  danger: "bg-destructive/10 text-destructive",
} as const;

export type StatusPillTone = keyof typeof STATUS_PILL_TONES;

// Span props pass through so a caller can put a `data-testid` and the machine
// value of what the pill is saying on it (QLTY-2). A pill's *word* is copy the
// facelift may reword; the state it stands for is not, and the E2E gate binds to
// that instead.
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
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_PILL_TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
