import { cn } from "@/lib/utils";
import { rowClassName } from "@/components/row";
import { type AdminGame } from "@picksleagues/schemas";
import { useAdminGames } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { gameStateLead, gameStatusLabel, matchupNumerals, scoreText } from "@/lib/game";
import { useAppNow } from "@/lib/app-clock";
import { MatchupLine, MatchupSide } from "@/components/league/matchup-line";
import { LabeledValue } from "@/components/labeled-value";
import {
  seasonLabel,
  useAdminSeasonWeekSelection,
} from "@/components/admin/use-season-week-selection";
import { Section } from "@/components/section";
import { LabeledSelect } from "@/components/labeled-select";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";

/**
 * Selection lives in the URL (owned by the route), not in state: a specific
 * week's slate is worth sharing while debugging a sync, and it survives a
 * refresh. Both params are optional — an absent one derives to the newest
 * season and its *current* week (server-resolved, FB-11 — defaulting to week 1
 * had operators editing a week the clock had long left), so the browser opens
 * on something useful with no effect-driven setState cascade.
 */
export function GamesBrowser({
  seasonId,
  weekId,
  onSeasonChange,
  onWeekChange,
}: {
  seasonId?: string;
  weekId?: string;
  onSeasonChange: (seasonId: string) => void;
  onWeekChange: (weekId: string) => void;
}) {
  const { seasons, all, selectedSeason, effectiveWeekId } = useAdminSeasonWeekSelection(
    seasonId,
    weekId,
  );
  const games = useAdminGames(effectiveWeekId);

  return (
    <Section title="Games" description="The synced games for a week, as the app serves them.">
      <QueryState
        isPending={seasons.isPending}
        isError={seasons.isError}
        onRetry={() => seasons.refetch()}
        errorMessage="Couldn't load seasons."
        pendingFallback={
          <RowsSkeleton label="Loading seasons" rows={2} rowClassName="h-9 w-full sm:max-w-xs" />
        }
        isEmpty={all.length === 0}
        emptyMessage="No seasons synced yet."
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledSelect
              id="games-browser-season"
              label="Season"
              value={selectedSeason?.id ?? null}
              // Drops the week: carrying one over from a different season
              // would select a week this season doesn't have.
              onValueChange={onSeasonChange}
              options={all.map((season) => ({
                value: season.id,
                label: seasonLabel(season),
              }))}
            />
            <LabeledSelect
              id="games-browser-week"
              label="Week"
              value={effectiveWeekId ?? null}
              onValueChange={onWeekChange}
              options={(selectedSeason?.weeks ?? []).map((week) => ({
                value: week.id,
                label: week.label,
              }))}
            />
          </div>

          {/* A season with no weeks leaves the games query skipped, which
                reports `isPending` forever — treat "nothing to ask for" as an
                empty state rather than a load that never resolves. */}
          <QueryState
            isPending={Boolean(effectiveWeekId) && games.isPending}
            isError={games.isError}
            onRetry={() => games.refetch()}
            errorMessage="Couldn't load games."
            pendingFallback={
              <RowsSkeleton label="Loading games" rows={6} rowClassName="h-14 w-full" />
            }
            isEmpty={!effectiveWeekId || games.data?.games.length === 0}
            emptyMessage={
              effectiveWeekId
                ? "No games synced for this week."
                : "No weeks synced for this season."
            }
          >
            <ul className="flex flex-col">
              {games.data?.games.map((game) => (
                <GameRow key={game.id} game={game} />
              ))}
            </ul>
          </QueryState>
        </div>
      </QueryState>
    </Section>
  );
}

function GameRow({ game }: { game: AdminGame }) {
  const now = useAppNow();
  const numerals = matchupNumerals(game, game.spread);

  return (
    <li className={cn(rowClassName, "flex flex-col gap-2")}>
      <MatchupLine
        away={<MatchupSide team={game.awayTeam} numeral={numerals.away} side="away" />}
        center={gameStateLead(game, now)}
        home={<MatchupSide team={game.homeTeam} numeral={numerals.home} side="home" />}
      />

      <div className="flex flex-col gap-1 text-xs text-foreground">
        <LabeledValue label="Kickoff">
          <span>{formatDateTime(game.kickoffAt)}</span>
        </LabeledValue>
        <LabeledValue label="Status">
          <span>{`${gameStatusLabel(game.status)}${scoreText(game.awayScore, game.homeScore)}`}</span>
        </LabeledValue>
        <LabeledValue label="Spread">
          <span>{game.spread === null ? "no line" : String(game.spread)}</span>
        </LabeledValue>
      </div>

      <p className="text-xs text-muted-foreground">provider game id {game.providerGameId}</p>
    </li>
  );
}
