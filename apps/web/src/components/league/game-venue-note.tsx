import type { SlateGame } from "@picksleagues/schemas";
import { MapPinIcon } from "lucide-react";
import { venuePlaceLabel } from "@/lib/game";

/**
 * Where a neutral-site game is played (FB-46), as a muted footnote on the
 * row's tag line — the thing that explains a 9:30 AM kickoff. Neutral-site
 * games only: every game has a venue, and a place under all sixteen rows would
 * bury the four a season that are actually unusual. The Stats sheet names
 * every game's venue for anyone who wants it.
 *
 * Ink, never a `StatusPill`: a place isn't a state of the game or the pick,
 * and nothing about it is the member's to act on (ADR-0043 §3).
 */
export function GameVenueNote({ game }: { game: Pick<SlateGame, "neutralSite" | "venue"> }) {
  if (!game.neutralSite || game.venue === null) return null;
  return (
    <span
      className="flex items-center gap-1 text-xs text-muted-foreground"
      data-testid="game-venue"
    >
      <MapPinIcon aria-hidden="true" className="size-3.5" />
      {venuePlaceLabel(game.venue)}
    </span>
  );
}
