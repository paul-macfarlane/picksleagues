import { useState } from "react";
import type { AdminNflTeamSeasonStats } from "@picksleagues/schemas";
import { useAdminNflStats } from "@/api/admin-nfl-stats";
import { formatDateTime } from "@/lib/format";
import { recordLabel, streakLabel } from "@/lib/nfl-stats";
import { NflStatsOverrideForm } from "@/components/admin/nfl-stats-override-form";
import { nflStatsOverrideFormSeed } from "@/components/admin/nfl-stats-override-patch";
import { ResolvedField } from "@/components/admin/override-display";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LabeledSelect } from "@/components/labeled-select";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";

function isOverridden(stats: AdminNflTeamSeasonStats): boolean {
  // `overriddenAt` is set exactly while any override field is (cleared with
  // the last one, arch D15), so it stands in for checking all twelve.
  return stats.overriddenAt !== null;
}

/**
 * The season-stats browser (STAT-7, ADR-0041): what the stats sync wrote per
 * team, with the override layer and the resolved values the matchup sheet
 * serves. Season selection lives in the URL (owned by the route) like the
 * games browser's week — a season worth inspecting is worth sharing.
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
    <Card>
      <CardHeader>
        <CardTitle>Team season stats</CardTitle>
        <CardDescription>
          Provider, override, and resolved record facts per team. Averages and league ranks on the
          member surface derive from the resolved values.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                <ul className="flex flex-col gap-3">
                  {stats.data.stats.map((row) => (
                    <StatsRow key={row.id} stats={row} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function StatsRow({ stats }: { stats: AdminNflTeamSeasonStats }) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {stats.team.abbreviation} · {stats.team.name}
        </p>
        {isOverridden(stats) && (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
            Overridden
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1 text-xs text-foreground">
        <ResolvedField
          label="Record"
          resolved={recordLabel(stats.effectiveWins, stats.effectiveLosses, stats.effectiveTies)}
          provider={recordLabel(stats.wins, stats.losses, stats.ties)}
          showProvider={
            stats.overrideWins !== null ||
            stats.overrideLosses !== null ||
            stats.overrideTies !== null
          }
        />
        <ResolvedField
          label="Home"
          resolved={recordLabel(
            stats.effectiveHomeWins,
            stats.effectiveHomeLosses,
            stats.effectiveHomeTies,
          )}
          provider={recordLabel(stats.homeWins, stats.homeLosses, stats.homeTies)}
          showProvider={
            stats.overrideHomeWins !== null ||
            stats.overrideHomeLosses !== null ||
            stats.overrideHomeTies !== null
          }
        />
        <ResolvedField
          label="Road"
          resolved={recordLabel(
            stats.effectiveRoadWins,
            stats.effectiveRoadLosses,
            stats.effectiveRoadTies,
          )}
          provider={recordLabel(stats.roadWins, stats.roadLosses, stats.roadTies)}
          showProvider={
            stats.overrideRoadWins !== null ||
            stats.overrideRoadLosses !== null ||
            stats.overrideRoadTies !== null
          }
        />
        <ResolvedField
          label="Streak"
          resolved={streakLabel(stats.effectiveStreak)}
          provider={streakLabel(stats.streak)}
          showProvider={stats.overrideStreak !== null}
        />
        <ResolvedField
          label="Points"
          resolved={`${stats.effectivePointsFor} for · ${stats.effectivePointsAgainst} against`}
          provider={`${stats.pointsFor} for · ${stats.pointsAgainst} against`}
          showProvider={stats.overridePointsFor !== null || stats.overridePointsAgainst !== null}
        />
      </div>

      <p className="text-xs text-muted-foreground">updated {formatDateTime(stats.updatedAt)}</p>

      {/* Same open/remount contract as the games browser: never rendered
          hidden, and the form re-seeds when its override values change
          server-side (fingerprint key) so a save can't leave a stale diff
          baseline in a still-open editor. */}
      <details open={editOpen} onToggle={(event) => setEditOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs text-muted-foreground select-none">
          Edit override
        </summary>
        {editOpen && (
          <NflStatsOverrideForm
            key={JSON.stringify(nflStatsOverrideFormSeed(stats))}
            stats={stats}
          />
        )}
      </details>
    </li>
  );
}
