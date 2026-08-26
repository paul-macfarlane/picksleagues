import { cn } from "@/lib/utils";
import { rowClassName } from "@/components/row";
import type { AdminNflTeamSeasonStats } from "@picksleagues/schemas";
import { useAdminNflStats } from "@/api/admin-nfl-stats";
import { formatDateTime } from "@/lib/format";
import { recordLabel, streakLabel } from "@/lib/nfl-stats";
import { LabeledValue } from "@/components/labeled-value";
import { Section } from "@/components/section";
import { LabeledSelect } from "@/components/labeled-select";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";

/**
 * The season-stats browser (STAT-7): what the stats sync wrote per team.
 * Season selection lives in the URL (owned by the route) like the games
 * browser's week — a season worth inspecting is worth sharing.
 */
export function NflStatsBrowser({
  season,
  onSeasonChange,
}: {
  season?: number;
  onSeasonChange: (season: number) => void;
}) {
  const stats = useAdminNflStats(season);

  return (
    <Section
      title="Team season stats"
      description="Record facts per team as the stats sync wrote them. Averages and league ranks on the member surface derive from these."
    >
      <QueryState
        isPending={stats.isPending}
        isError={stats.isError}
        onRetry={() => stats.refetch()}
        errorMessage="Couldn't load team season stats."
        pendingFallback={
          <RowsSkeleton label="Loading team season stats" rows={6} rowClassName="h-14 w-full" />
        }
        isEmpty={stats.data?.seasonYears.length === 0}
        emptyMessage="No team stats synced yet — run sync-stats."
      >
        {stats.data && (
          <div className="flex flex-col gap-4">
            <div className="sm:max-w-xs">
              <LabeledSelect
                id="nfl-stats-browser-season"
                label="Season"
                value={stats.data.seasonYear === null ? null : String(stats.data.seasonYear)}
                onValueChange={(value) => onSeasonChange(Number(value))}
                options={stats.data.seasonYears.map((year) => ({
                  value: String(year),
                  label: String(year),
                }))}
              />
            </div>
            {stats.data.stats.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No rows for this season.
              </p>
            ) : (
              <ul className="flex flex-col">
                {stats.data.stats.map((row) => (
                  <StatsRow key={row.id} stats={row} />
                ))}
              </ul>
            )}
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function StatsRow({ stats }: { stats: AdminNflTeamSeasonStats }) {
  return (
    <li className={cn(rowClassName, "flex flex-col gap-2")}>
      <p className="text-sm text-foreground">
        <span className="type-display text-xl">{stats.team.abbreviation}</span>{" "}
        <span className="text-muted-foreground">{stats.team.name}</span>
      </p>

      <div className="flex flex-col gap-1 text-xs text-foreground">
        <LabeledValue label="Record">
          {recordLabel(stats.wins, stats.losses, stats.ties)}
        </LabeledValue>
        <LabeledValue label="Home">
          {recordLabel(stats.homeWins, stats.homeLosses, stats.homeTies)}
        </LabeledValue>
        <LabeledValue label="Road">
          {recordLabel(stats.roadWins, stats.roadLosses, stats.roadTies)}
        </LabeledValue>
        <LabeledValue label="Streak">{streakLabel(stats.streak)}</LabeledValue>
        <LabeledValue label="Points">
          {stats.pointsFor} for · {stats.pointsAgainst} against
        </LabeledValue>
      </div>

      <p className="type-eyebrow">updated {formatDateTime(stats.updatedAt)}</p>
    </li>
  );
}
