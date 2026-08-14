import { NFL_LAST_GAME_RESULT, type NflGameStatsTeamContext } from "@picksleagues/schemas";

/**
 * The matchup sheet's comparison-row primitives (STAT-6/STAT-10): one grid row
 * of "away value | label | home value", and the advantage computation that
 * decides which side gets the edge dot. Split from the sheet so the sheet file
 * stays the composition and this stays the row mechanics.
 */

export type AdvantageSide = "away" | "home" | null;

/**
 * Which side is ahead on one comparable number (STAT-10). Null — no marker —
 * when either side lacks the number or they tie: the indicator only ever
 * states an edge the data holds, never breaks a tie by decoration.
 */
export function advantageOf(
  away: number | null | undefined,
  home: number | null | undefined,
  direction: "higher" | "lower" = "higher",
): AdvantageSide {
  if (away === null || away === undefined || home === null || home === undefined) return null;
  if (away === home) return null;
  const awayBetter = direction === "higher" ? away > home : away < home;
  return awayBetter ? "away" : "home";
}

/** Ties count half, the standings convention, so 4-2-1 beats 4-3-0. */
export function winPct(wins: number, losses: number, ties: number): number | null {
  const played = wins + losses + ties;
  return played === 0 ? null : (wins + 0.5 * ties) / played;
}

export function lastFiveWins(context: NflGameStatsTeamContext | undefined): number | null {
  if (!context || context.lastFive.length === 0) return null;
  return context.lastFive.filter((game) => game.result === NFL_LAST_GAME_RESULT.WIN).length;
}

/**
 * The edge marker: a dot the eye can scan down a column of numbers, plus
 * hidden text so a screen reader hears the same claim the dot makes — a
 * color-only or glyph-only marker would say nothing to it.
 */
function EdgeDot() {
  return (
    <>
      <span aria-hidden="true" className="inline-block size-1.5 shrink-0 rounded-full bg-primary" />
      <span className="sr-only">(edge)</span>
    </>
  );
}

/** One "away value | label | home value" line of the stat grid. */
export function StatRow({
  label,
  away,
  home,
  subLabel,
  advantage = null,
}: {
  label: string;
  away: string;
  home: string;
  subLabel?: string;
  advantage?: AdvantageSide;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
        {away}
        {advantage === "away" && <EdgeDot />}
      </span>
      <span className="text-center text-xs text-muted-foreground">
        {label}
        {subLabel && <span className="block text-[10px] text-muted-foreground/70">{subLabel}</span>}
      </span>
      <span className="flex items-center justify-end gap-1.5 text-right text-sm font-medium tabular-nums">
        {advantage === "home" && <EdgeDot />}
        {home}
      </span>
    </div>
  );
}
