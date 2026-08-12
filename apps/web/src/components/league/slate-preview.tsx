import type { WeekSlateResponse } from "@picksleagues/schemas";
import { gameStateLabel } from "@/lib/game";
import { useAppNow } from "@/lib/app-clock";
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
    <ul className="flex flex-col gap-2">
      {slate.games.map((game) => (
        <li
          key={game.id}
          data-testid="slate-preview-row"
          className="flex flex-col gap-1 rounded-lg border border-border p-3"
        >
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
          {/* Kickoff phrased against the app clock, which under the simulator
              is months away from the browser's. */}
          <p className="text-xs text-muted-foreground">{gameStateLabel(game, now)}</p>
        </li>
      ))}
    </ul>
  );
}
