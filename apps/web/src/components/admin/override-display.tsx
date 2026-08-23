import type { ReactNode } from "react";
import { LabeledValue } from "@/components/labeled-value";
import { StatusPill } from "@/components/status-pill";

/**
 * The presentational halves of the admin override idiom (arch D15), shared
 * by every browser/editor pair (games, teams, NFL stats, stat contexts): a
 * browser row shows the *resolved* value with the provider's beside it when
 * an override is masking it, a tag says the row is overridden at all, and a
 * form field shows the provider value it sits on top of — "what am I
 * overriding?" and "what would clearing restore?".
 */

export function ResolvedField({
  label,
  resolved,
  provider,
  showProvider,
}: {
  label: string;
  resolved: string;
  provider: string;
  showProvider: boolean;
}) {
  return (
    <LabeledValue label={label}>
      <span>{resolved}</span>
      {showProvider && <span className="text-muted-foreground">provider: {provider}</span>}
    </LabeledValue>
  );
}

/**
 * Danger rather than a neutral tag: an override is a hand on the scale the
 * next sync can't undo (arch D15), and the operator scanning a slate needs
 * the corrected rows to jump out, not blend into the lock-state tags.
 */
export function OverriddenTag({ className }: { className?: string }) {
  return (
    <StatusPill tone="danger" className={className}>
      Overridden
    </StatusPill>
  );
}

export function ProviderHint({ children, provider }: { children: ReactNode; provider: string }) {
  return (
    <div className="flex flex-col gap-1">
      {children}
      <p className="text-xs text-muted-foreground">Provider: {provider}</p>
    </div>
  );
}
