import { Link } from "@tanstack/react-router";
import type { AdminGame } from "@picksleagues/schemas";
import { cn } from "@/lib/utils";
import { rowClassName, rowRuleClassName } from "@/components/row";
import { useAdminGameAnomalies } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { adminGameEffective } from "@/lib/admin-game";
import { gameStatusLabel, matchupNumerals } from "@/lib/game";
import { MatchupLine, MatchupSide } from "@/components/league/matchup-line";
import { Section } from "@/components/section";
import { buttonVariants } from "@/components/ui/button";
import { LoadingRegion } from "@/components/loading";
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
    <Section
      title="Data integrity"
      description="Games whose kickoff is still ahead while their status or score already gives the outcome away — members can still pick them. Open the week and correct the kickoff or the result."
    >
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
        <ul className="flex flex-col">
          {games.map((game) => (
            <AnomalyRow key={game.id} game={game} />
          ))}
        </ul>
      </QueryState>
    </Section>
  );
}

function AnomaliesSkeleton() {
  return (
    <LoadingRegion label="Checking for unlocked games with known outcomes">
      <Skeleton className="h-20 w-full" />
    </LoadingRegion>
  );
}

function AnomalyRow({ game }: { game: AdminGame }) {
  const matchup = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;
  const effective = adminGameEffective(game);
  const numerals = matchupNumerals(effective, game.effectiveSpread);

  return (
    // The rule is destructive rather than a bordered box (ADR-0043 §2): a row
    // inside a section never draws its own border, and the colour on the edge
    // is what says "this one is wrong" without nesting a surface.
    <li
      className={cn(
        rowClassName,
        rowRuleClassName,
        "flex flex-col gap-2 border-l-destructive sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The score sits in the numeral slot while the kickoff is still
            ahead — that contradiction *is* the anomaly, and the line shows it
            as a member would see it. The centre is the absolute kickoff, not
            `gameStateLead`: a status word would hide the instant the row is
            about. */}
        <MatchupLine
          away={<MatchupSide team={game.awayTeam} numeral={numerals.away} side="away" />}
          center={`Kickoff ${formatDateTime(game.effectiveKickoffAt)}`}
          home={<MatchupSide team={game.homeTeam} numeral={numerals.home} side="home" />}
        />
        <p className="text-xs text-muted-foreground">{gameStatusLabel(game.effectiveStatus)}</p>
      </div>
      <Link
        to="/admin/games"
        search={{ weekId: game.weekId }}
        aria-label={`Open ${matchup} in the games browser`}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "self-start sm:self-center",
        )}
      >
        Open week
      </Link>
    </li>
  );
}
