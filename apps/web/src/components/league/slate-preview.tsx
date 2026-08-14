import type { WeekSlateResponse } from "@picksleagues/schemas";
import { gameStateLabel } from "@/lib/game";
import { useAppNow } from "@/lib/app-clock";
import { NflMatchupStats } from "@/components/league/nfl-matchup-stats-sheet";
import { TeamLogo } from "@/components/team-logo";

/**
 * A week's slate as something to read, not act on — the matchups and their
 * kickoffs, no controls (FB-20). Rendered under the "not open yet" notice on
 * weeks ahead of the pick window, because scouting ahead is legitimate play
 * (Survivor is *built* on planning which teams to burn when) and the schedule
 * is public data: pick visibility is per-pick and this shows none. Genuinely
 * mode-agnostic — both NFL modes render it unchanged, which is what earns the
 * generic name.
 */
export function SlatePreview({ slate }: { slate: WeekSlateResponse }) {
  const now = useAppNow();

  return (
    // Two columns from `sm` up: a full-width card holding one line of text
    // reads as a page of left-clustered slivers (owner, 2026-08-13).
    <ul className="grid gap-2 sm:grid-cols-2">
      {slate.games.map((game) => (
        <li
          key={game.id}
          data-testid="slate-preview-row"
          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-border p-3"
        >
          <div className="flex items-center gap-1">
            <p
              className="flex items-center gap-1.5 text-sm font-medium text-foreground"
              title={`${game.awayTeam.name} @ ${game.homeTeam.name}`}
            >
              <TeamLogo
                logoLightUrl={game.awayTeam.logoLightUrl}
                logoDarkUrl={game.awayTeam.logoDarkUrl}
                size="sm"
              />
              {game.awayTeam.abbreviation}
              <span className="text-muted-foreground">@</span>
              <TeamLogo
                logoLightUrl={game.homeTeam.logoLightUrl}
                logoDarkUrl={game.homeTeam.logoDarkUrl}
                size="sm"
              />
              {game.homeTeam.abbreviation}
            </p>
            {/* Scouting ahead is the whole reason this read-only slate exists
                (FB-20) — the matchup sheet is the same public data. */}
            <NflMatchupStats game={game} />
          </div>
          {/* Kickoff on the card's right edge — the same header shape as the
              game rows, whose right side carries state — phrased against the
              app clock, which under the simulator is months away from the
              browser's. */}
          <p className="text-xs text-muted-foreground">{gameStateLabel(game, now)}</p>
        </li>
      ))}
    </ul>
  );
}
