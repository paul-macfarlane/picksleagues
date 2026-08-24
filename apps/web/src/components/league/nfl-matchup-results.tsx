import type { NflGameLogEntry, NflTeamGameLog, SlateGame, SlateTeam } from "@picksleagues/schemas";
import { useNflGameResults } from "@/api/nfl-game-stats";
import { formatDateTime } from "@/lib/format";
import { LoadingRegion } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The matchup sheet's Results segment (STAT-9): both teams' season game logs
 * side by side, newest first, served from our `games` rows. Like the stats
 * body, everything renders from ingested data with its as-of stamp — a live
 * score is dated, never claimed real-time (spec §Data Freshness).
 */

// "Week 5" → "Wk 5": two columns of log rows share a phone width, and the
// provider's regular-season label is the one part that compresses without
// losing meaning. Postseason labels ("Wild Card") pass through untouched —
// their wording is the label (see the weeks table's `label` rationale).
function shortWeekLabel(label: string): string {
  return label.replace(/^Week /, "Wk ");
}

function scoreLabel(entry: NflGameLogEntry): string {
  if (entry.teamScore === null || entry.opponentScore === null) return "—";
  return `${entry.teamScore}-${entry.opponentScore}`;
}

function GameLogColumn({
  team,
  label,
  log,
}: {
  team: SlateTeam;
  label: string;
  log: NflTeamGameLog | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <TeamLogo logoLightUrl={team.logoLightUrl} logoDarkUrl={team.logoDarkUrl} size="sm" />
        {label}
      </p>
      {log === null ? (
        <p className="text-xs text-muted-foreground">No games yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {/* Index keys like the injury list: a served snapshot, never
              reordered client-side, and a week+opponent key collides the year
              a postponed rematch lands in the same labeled week. */}
          {log.entries.map((entry, index) => (
            <li key={index} className="flex items-baseline justify-between gap-2 py-1 text-xs">
              <span className="truncate text-muted-foreground">
                {shortWeekLabel(entry.weekLabel)} · {entry.atHome ? "vs" : "@"} {entry.opponentAbbr}
              </span>
              <span className="shrink-0 text-right">
                {entry.final ? (
                  entry.result ? (
                    <>
                      <span className="font-medium text-foreground">{entry.result}</span>{" "}
                      <span className="text-muted-foreground">{scoreLabel(entry)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )
                ) : (
                  <>
                    <span className="text-muted-foreground">{scoreLabel(entry)}</span>{" "}
                    <span className="type-eyebrow text-foreground">Live</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NflMatchupResultsBody({ game }: { game: SlateGame }) {
  const resultsQuery = useNflGameResults(game.id);

  return (
    <QueryState
      isPending={resultsQuery.isPending}
      pendingFallback={
        <LoadingRegion label="Loading game results" className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_unused, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </LoadingRegion>
      }
      isError={resultsQuery.isError}
      onRetry={() => void resultsQuery.refetch()}
      errorMessage="Couldn't load game results."
    >
      {resultsQuery.data &&
        (() => {
          const { home, away, updatedAt } = resultsQuery.data;

          if (!home && !away) {
            return (
              <p className="py-4 text-sm text-muted-foreground">
                No completed games for either team yet.
              </p>
            );
          }

          // Season captioning mirrors the stats body (ADR-0040's per-team
          // fallback): one caption when the columns agree, per-column years
          // when a side is still serving last season.
          const sharedSeasonYear = home && away && home.seasonYear === away.seasonYear;
          const columnLabel = (team: SlateTeam, log: NflTeamGameLog | null) =>
            log && !sharedSeasonYear
              ? `${team.abbreviation} (${log.seasonYear})`
              : team.abbreviation;

          return (
            <div className="flex flex-col gap-2" data-testid="nfl-matchup-results-body">
              <p className="type-eyebrow">
                {sharedSeasonYear && home ? `${home.seasonYear} season results` : "Season results"}
                {updatedAt && ` · updated ${formatDateTime(updatedAt)}`}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <GameLogColumn
                  team={game.awayTeam}
                  label={columnLabel(game.awayTeam, away)}
                  log={away}
                />
                <GameLogColumn
                  team={game.homeTeam}
                  label={columnLabel(game.homeTeam, home)}
                  log={home}
                />
              </div>
            </div>
          );
        })()}
    </QueryState>
  );
}
