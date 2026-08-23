import type { ReactNode } from "react";

/**
 * One line of a row's detail block: an eyebrow naming the field with the
 * value beside it on the same baseline — the inline counterpart of `Figures`'
 * eyebrow-over-numeral slot, for a value that is a sentence rather than a
 * number (a kickoff, a status, a record). Admin and sim rows stack several of
 * these, so the gap and the label role live here once.
 */
export function LabeledValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="type-eyebrow">{label}</span>
      {children}
    </span>
  );
}
