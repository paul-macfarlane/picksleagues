import { GAME_STATUS } from "@picksleagues/schemas";
import type {
  NflGameScheduleEntry,
  NflTeamSchedule,
  SlateGame,
  SlateTeam,
} from "@picksleagues/schemas";
import { useNflGameSchedule } from "@/api/nfl-game-stats";
import { useAppNow } from "@/lib/app-clock";
import { formatDateTime, formatKickoff } from "@/lib/format";
import { LoadingRegion } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The matchup sheet's Schedule segment (STAT-9): both teams' available season
 * fixtures side by side, kickoff-ordered and served from our `games` rows.
 * Like the stats body, everything renders from ingested data with its as-of
 * stamp — a live score is dated, never claimed real-time (spec §Data Freshness).
 */

// "Week 5" → "Wk 5": two columns of schedule rows share a phone width, and the
// provider's regular-season label is the one part that compresses without
// losing meaning. Postseason labels ("Wild Card") pass through untouched —
// their wording is the label (see the weeks table's `label` rationale).
function shortWeekLabel(label: string): string {
  return label.replace(/^Week /, "Wk ");
}

function scoreLabel(entry: NflGameScheduleEntry, teamAbbr: string): string {
  if (entry.kind === "bye") return "Bye";
  return `${teamAbbr} ${entry.teamScore ?? "—"} – ${entry.opponentAbbr} ${entry.opponentScore ?? "—"}`;
}

function stateLabel(entry: NflGameScheduleEntry, now: Date): string {
  if (entry.kind === "bye") return "Bye";
  switch (entry.status) {
    case GAME_STATUS.FINAL:
      return entry.result ? `Final · ${entry.result}` : "Final";
    case GAME_STATUS.IN_PROGRESS:
      return "Live";
    case GAME_STATUS.POSTPONED:
      return "Postponed";
    case GAME_STATUS.CANCELLED:
      return "Cancelled";
    case GAME_STATUS.SCHEDULED:
      return formatKickoff(entry.kickoffAt, now);
  }
}

function ScheduleColumn({
  team,
  label,
  log,
}: {
  team: SlateTeam;
  label: string;
  log: NflTeamSchedule | null;
}) {
  const now = useAppNow();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <TeamLogo logoLightUrl={team.logoLightUrl} logoDarkUrl={team.logoDarkUrl} size="sm" />
        {label}
      </p>
      {log === null ? (
        <p className="text-xs text-muted-foreground">No schedule ingested yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {/* Index keys like the injury list: a served snapshot, never
              reordered client-side, and a week+opponent key collides the year
              a postponed rematch lands in the same labeled week. */}
          {log.entries.map((entry, index) => (
            <li key={index} className="flex flex-col gap-1 py-2 text-xs">
              {entry.kind === "bye" ? (
                <span className="font-medium">{shortWeekLabel(entry.weekLabel)} · Bye</span>
              ) : (
                <>
                  <span className="font-medium">
                    {shortWeekLabel(entry.weekLabel)} · {entry.atHome ? "vs" : "@"}{" "}
                    {entry.opponentAbbr}
                  </span>
                  <span className="text-muted-foreground">{stateLabel(entry, now)}</span>
                  {(entry.status === GAME_STATUS.FINAL ||
                    entry.status === GAME_STATUS.IN_PROGRESS) && (
                    <span className="text-muted-foreground">
                      {scoreLabel(entry, team.abbreviation)}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NflMatchupScheduleBody({ game }: { game: SlateGame }) {
  const scheduleQuery = useNflGameSchedule(game.id);

  return (
    <QueryState
      isPending={scheduleQuery.isPending}
      pendingFallback={
        <LoadingRegion label="Loading team schedules" className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_unused, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </LoadingRegion>
      }
      isError={scheduleQuery.isError}
      onRetry={() => void scheduleQuery.refetch()}
      errorMessage="Couldn't load team schedules."
    >
      {scheduleQuery.data &&
        (() => {
          const { home, away, updatedAt } = scheduleQuery.data;

          if (!home && !away) {
            return (
              <p className="py-4 text-sm text-muted-foreground">
                No schedule data for either team yet — it arrives with the next sync.
              </p>
            );
          }

          // Season captioning mirrors the stats body (ADR-0040's per-team
          // fallback): one caption when the columns agree, per-column years
          // when a side is still serving last season.
          const sharedSeasonYear = home && away && home.seasonYear === away.seasonYear;
          const columnLabel = (team: SlateTeam, log: NflTeamSchedule | null) =>
            log && !sharedSeasonYear
              ? `${team.abbreviation} (${log.seasonYear})`
              : team.abbreviation;

          return (
            <div className="flex flex-col gap-2" data-testid="nfl-matchup-schedule-body">
              <p className="type-eyebrow">
                {sharedSeasonYear && home
                  ? `${home.seasonYear} season schedule`
                  : "Season schedule"}
                {updatedAt && ` · updated ${formatDateTime(updatedAt)}`}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <ScheduleColumn
                  team={game.awayTeam}
                  label={columnLabel(game.awayTeam, away)}
                  log={away}
                />
                <ScheduleColumn
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
