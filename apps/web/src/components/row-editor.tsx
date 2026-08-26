import { useState, type ReactNode } from "react";

/**
 * The inline editor a browser row opens beneath itself — the sim fixture
 * editor today. The child is **never rendered hidden**:
 * it mounts on open and unmounts on close, so an editor always seeds from the
 * row's current props rather than from whatever the row held when the page
 * loaded. A caller that keys the child on a fingerprint of its server-side
 * values gets the other half of the contract — a still-open editor re-seeds
 * when a save (or another operator's) changes what it diffs against, which is
 * what keeps a diff-based save from writing a stale baseline.
 */
export function RowEditor({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="type-eyebrow cursor-pointer select-none hover:text-foreground">
        {label}
      </summary>
      {open && children}
    </details>
  );
}
