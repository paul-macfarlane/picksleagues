import { Link } from "@tanstack/react-router";
import type { AdminGame } from "@picksleagues/schemas";
import { useAdminGameAnomalies } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { gameStatusLabel, scoreText } from "@/lib/game";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryState } from "@/components/query-state";

/**
 * Games the API found still unlocked while their outcome is already knowable —
 * members can pick against a result the app is already showing them (arch D11:
 * lock state is derived, so nothing flips such a game shut on its own). The
 * admin override guard refuses to *create* this state, but a provider bug and a
 * legitimate later-kickoff override followed by score ingestion both reach it
 * with no admin at fault, so the operator needs it surfaced.
 *
 * Kickoffs read absolute rather than relative to the app clock: this list is
 * *about* the relationship between a kickoff and now, and "in 2 days" is the one
 * phrasing that can't be checked against the scoreboard beside it.
 */
export function GameAnomaliesCard() {
  const anomalies = useAdminGameAnomalies();
  const games = anomalies.data?.games ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data integrity</CardTitle>
        <CardDescription>
          Games whose kickoff is still ahead while their status or score already gives the outcome
          away — members can still pick them. Open the week and correct the kickoff or the result.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          isPending={anomalies.isPending}
          pendingFallback={<AnomaliesSkeleton />}
          isError={anomalies.isError}
          onRetry={() => anomalies.refetch()}
          errorMessage="Couldn't check for unlocked games with known outcomes."
          isEmpty={games.length === 0}
          // Stated rather than left blank: a card with nothing in it can't tell
          // an operator "the check ran and found nothing" from "the check never
          // ran", and those need opposite responses.
          emptyMessage="All clear — no game is unlocked with a knowable outcome."
        >
          <ul className="flex flex-col gap-3">
            {games.map((game) => (
              <AnomalyRow key={game.id} game={game} />
            ))}
          </ul>
        </QueryState>
      </CardContent>
    </Card>
  );
}

function AnomaliesSkeleton() {
  return (
    <div role="status" aria-label="Checking for unlocked games with known outcomes">
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function AnomalyRow({ game }: { game: AdminGame }) {
  const matchup = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <p
          className="text-sm font-medium text-foreground"
          title={`${game.awayTeam.name} @ ${game.homeTeam.name}`}
        >
          {matchup}
        </p>
        <p className="text-xs text-foreground">
          Kickoff {formatDateTime(game.effectiveKickoffAt)}
          <span className="text-muted-foreground">
            {" · "}
            {gameStatusLabel(game.effectiveStatus)}
            {scoreText(game.effectiveAwayScore, game.effectiveHomeScore)}
          </span>
        </p>
      </div>
      <Link
        to="/admin/games"
        search={{ weekId: game.weekId }}
        aria-label={`Open ${matchup} in the games browser`}
        className="self-start rounded-md border border-border px-2 py-1 text-xs text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Open week
      </Link>
    </li>
  );
}
