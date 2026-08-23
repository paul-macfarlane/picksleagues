import type { WeekSlateResponse } from "@picksleagues/schemas";
import { gameStateLead, matchupNumerals } from "@/lib/game";
import { useAppNow } from "@/lib/app-clock";
import { cn } from "@/lib/utils";
import { MatchupLine, MatchupSide } from "@/components/league/matchup-line";
import { NflMatchupStats } from "@/components/league/nfl-matchup-stats-sheet";
import { rowClassName } from "@/components/row";

/**
 * A week's slate as something to read, not act on — the matchups and their
 * kickoffs, no controls (FB-20). Rendered under the "not open yet" notice on
 * weeks ahead of the pick window, because scouting ahead is legitimate play
 * (Survivor is *built* on planning which teams to burn when) and the schedule
 * is public data: pick visibility is per-pick and this shows none. Genuinely
 * mode-agnostic — both NFL modes render it unchanged, which is what earns the
 * generic name, and why the numeral slot shows no line: a spread is Pick'em's
 * number, and a Survivor member scouting ahead has no use for it. A score,
 * once a game has one, is every mode's.
 */
export function SlatePreview({ slate }: { slate: WeekSlateResponse }) {
  const now = useAppNow();

  return (
    <ul className="flex flex-col">
      {slate.games.map((game) => {
        const numerals = matchupNumerals(game, null);
        return (
          <li
            key={game.id}
            data-testid="slate-preview-row"
            className={cn(rowClassName, "flex flex-col gap-1")}
          >
            {/* Kickoff in the centre, phrased against the app clock — under the
                simulator months away from the browser's. */}
            <MatchupLine
              away={<MatchupSide team={game.awayTeam} numeral={numerals.away} side="away" />}
              center={gameStateLead(game, now)}
              home={<MatchupSide team={game.homeTeam} numeral={numerals.home} side="home" />}
            />
            {/* Scouting ahead is the whole reason this read-only slate exists
                (FB-20) — the matchup sheet is the same public data. */}
            <div className="flex">
              <NflMatchupStats game={game} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
