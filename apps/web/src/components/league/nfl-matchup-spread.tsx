import { GAME_SIDE, type SlateGame } from "@picksleagues/schemas";
import { spreadLabel } from "@/lib/game";
import { MatchupLine, MatchupSide } from "@/components/league/matchup-line";

/** The synced line remains available in every stats view, even before stats arrive. */
export function NflMatchupSpread({ game }: { game: SlateGame }) {
  return (
    <div className="mb-4 flex flex-col gap-1" data-testid="matchup-spread">
      <MatchupLine
        away={
          <MatchupSide
            team={game.awayTeam}
            side={GAME_SIDE.AWAY}
            numeral={spreadLabel(game.spread, GAME_SIDE.AWAY) ?? "—"}
          />
        }
        center="Spread"
        home={
          <MatchupSide
            team={game.homeTeam}
            side={GAME_SIDE.HOME}
            numeral={spreadLabel(game.spread, GAME_SIDE.HOME) ?? "—"}
          />
        }
      />
      <p className="text-center text-xs text-muted-foreground">
        {game.spread === null
          ? "No spread available yet."
          : `${game.spreadSource ? `${game.spreadSource} · ` : ""}Minus = favorite · Plus = underdog`}
      </p>
    </div>
  );
}
