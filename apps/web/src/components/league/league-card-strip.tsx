import type { ReactNode } from "react";
import type { LeagueMode } from "@picksleagues/schemas";
import { leagueModeLabel } from "@/lib/league";
import { Band } from "@/components/band";

/**
 * A league card's top strip (ADR-0043 §2): the league header's band at card
 * scale, so a league looks like the same thing on the hub, in discovery, and on
 * its own page. The name is the card's subject in display type; the eyebrow
 * above it is the mode and season, the same two words the header leads with.
 *
 * Rendered as the first child of a `Card` with its top padding removed — the
 * card's own `overflow-hidden` radius clips the strip's corners, so the strip
 * carries none of its own.
 */
export function LeagueCardStrip({
  mode,
  seasonYear,
  children,
}: {
  mode: LeagueMode;
  seasonYear: number;
  /** The league name — a link on the hub, plain text in discovery. */
  children: ReactNode;
}) {
  return (
    <Band className="gap-1 rounded-none py-3">
      <p className="type-eyebrow">
        {leagueModeLabel(mode)} · {seasonYear}
      </p>
      <p className="type-display text-xl break-words">{children}</p>
    </Band>
  );
}
