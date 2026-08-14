import type { ReactNode } from "react";

/**
 * The two presentational halves of the admin override idiom (arch D15),
 * shared by every browser/editor pair (games, NFL stats, stat contexts):
 * a browser row shows the *resolved* value with the provider's beside it when
 * an override is masking it, and a form field shows the provider value it
 * sits on top of — "what am I overriding?" and "what would clearing restore?".
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
    <span>
      {label} {resolved}
      {showProvider && <span className="text-muted-foreground"> · provider: {provider}</span>}
    </span>
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
