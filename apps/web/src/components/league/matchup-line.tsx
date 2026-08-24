import type { ComponentProps, ReactNode } from "react";
import { GAME_SIDE, type GameSide } from "@picksleagues/schemas";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/team-logo";

/**
 * The signature matchup line (ADR-0043 §5): two team cells facing each other
 * across a centre column, the abbreviation in display type and a numeral
 * beside it that is the line before kickoff and the score after
 * (`matchupNumerals`). One component behind the Pick'em sheet, the Survivor
 * sheet, the All Picks breakdown, the slate preview, and the admin games
 * browser, so the row's shape is the same on every surface and across every
 * state — only what the slot holds and what the row's left rule says changes.
 *
 * Layout only. A cell is whatever the caller hands it — a `MatchupSide` bare
 * on a read-only surface, or one inside a pick control on a sheet — because
 * the cell's interactivity is the surface's business and the line's job is to
 * hold the two in the same shape either way.
 *
 * The whitespace between the three columns is deliberate and load-bearing: a
 * grid drops whitespace-only text nodes from layout, so it costs nothing on
 * screen, but it is what makes the line's text content read "MIA 17 Final
 * BUF 27" to a screen reader and to the merge-gate journey, instead of the
 * three runs fused into one word. `MatchupSide` does the same inside a cell.
 */
export function MatchupLine({
  away,
  center,
  home,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  away: ReactNode;
  center: ReactNode;
  home: ReactNode;
}) {
  return (
    <div className={cn("grid grid-cols-[1fr_auto_1fr] items-center gap-x-2", className)} {...props}>
      {/* Each cell hugs the centre column, so on a wide screen the two sides
          still face each other across it instead of drifting to the page
          edges; a cell's own width is the caller's to cap. */}
      <div className="flex min-w-0 justify-end">{away}</div>{" "}
      <span className="type-eyebrow min-w-20 text-center">{center}</span>{" "}
      <div className="flex min-w-0 justify-start">{home}</div>
    </div>
  );
}

export type MatchupSideTeam = {
  abbreviation: string;
  name: string;
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
};

/**
 * One team cell: logo, abbreviation, numeral, the numeral on the edge nearest
 * the centre column so the two numbers on a line face each other. The home
 * cell mirrors visually via `flex-row-reverse`, never in DOM order, so its
 * text still reads "BUF 27" — the abbreviation names the number that follows
 * it, which is the convention the All Picks journey asserts the score by.
 *
 * Display type at `text-xl`: 20px is the display role's floor (ADR-0043 §1),
 * and the condensed face at that size is what lets abbreviation, numeral and
 * logo share a cell with the centre column at 390px.
 *
 * `emphasis` is for a read-only surface telling apart the side a member took
 * from the one they didn't — ink weight, not orange, because another member's
 * choice is not the viewer's to act on (ADR-0043 §3). A sheet's cells sit
 * inside a button that carries the held state itself and pass nothing here.
 */
export function MatchupSide({
  team,
  numeral,
  side,
  emphasis,
  className,
}: {
  team: MatchupSideTeam;
  numeral: string | null;
  side: GameSide;
  emphasis?: "taken" | "other";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        side === GAME_SIDE.HOME && "flex-row-reverse",
        emphasis === "other" && "text-muted-foreground",
        className,
      )}
      title={team.name}
    >
      <TeamLogo
        logoLightUrl={team.logoLightUrl ?? null}
        logoDarkUrl={team.logoDarkUrl ?? null}
        size="sm"
      />
      <span className="type-display text-xl">{team.abbreviation}</span>{" "}
      {/* Always rendered, so a cell whose slot is empty keeps the width of one
          that isn't and the abbreviations in a slate line up down the column. */}
      <span
        className={cn(
          "type-display min-w-[3ch] text-xl",
          side === GAME_SIDE.AWAY ? "text-left" : "text-right",
        )}
      >
        {numeral}
      </span>
    </span>
  );
}
