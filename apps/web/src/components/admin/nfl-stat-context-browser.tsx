import { useState } from "react";
import type {
  AdminNflGameStatContext,
  NflGameStatsTeamContext,
  NflTeamGameContextOverride,
} from "@picksleagues/schemas";
import { useAdminNflStatContexts } from "@/api/admin-nfl-stats";
import { formatDateTime } from "@/lib/format";
import { NflStatContextOverrideForm } from "@/components/admin/nfl-stat-context-override-form";
import { nflContextOverrideFormSeed } from "@/components/admin/nfl-context-override-patch";
import { ResolvedField } from "@/components/admin/override-display";
import {
  seasonLabel,
  useAdminSeasonWeekSelection,
} from "@/components/admin/use-season-week-selection";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LabeledSelect } from "@/components/labeled-select";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";

/** One line's worth of a side's context — compact on purpose; the form has the detail. */
function sideSummary(context: NflGameStatsTeamContext): string {
  const injuries = `${context.injuries.length} ${context.injuries.length === 1 ? "injury" : "injuries"}`;
  const fpi = context.fpiWinPct !== null ? `FPI ${context.fpiWinPct.toFixed(1)}%` : "FPI —";
  const ats = `ATS ${context.atsSummary ?? "—"}`;
  const lastFive =
    context.lastFive.length > 0
      ? `last ${context.lastFive.length}: ${context.lastFive.map((game) => game.result).join("-")}`
      : "last 5 —";
  return `${injuries} · ${fpi} · ${ats} · ${lastFive}`;
}

function sideOverridden(override: NflTeamGameContextOverride | undefined): boolean {
  return override !== undefined && Object.keys(override).length > 0;
}

/**
 * The game stat context browser (STAT-7, ADR-0041): a week's per-game context
 * payloads — including games the sync hasn't reached, which is the browser's
 * whole verification value — with the sparse override layer beside them.
 */
export function NflStatContextBrowser({
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
  const contexts = useAdminNflStatContexts(effectiveWeekId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Game stat context</CardTitle>
        <CardDescription>
          Injuries, FPI, ATS, and recent form per game — provider payload, sparse override, and the
          resolved values the matchup sheet serves.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                id="stat-context-browser-season"
                label="Season"
                value={selectedSeason?.id ?? null}
                onValueChange={onSeasonChange}
                options={all.map((season) => ({ value: season.id, label: seasonLabel(season) }))}
              />
              <LabeledSelect
                id="stat-context-browser-week"
                label="Week"
                value={effectiveWeekId ?? null}
                onValueChange={onWeekChange}
                options={(selectedSeason?.weeks ?? []).map((week) => ({
                  value: week.id,
                  label: week.label,
                }))}
              />
            </div>

            {/* A season with no weeks leaves the query skipped — "nothing to
                ask for" is an empty state, not a load that never resolves. */}
            <QueryState
              isPending={Boolean(effectiveWeekId) && contexts.isPending}
              isError={contexts.isError}
              onRetry={() => contexts.refetch()}
              errorMessage="Couldn't load stat contexts."
              pendingFallback={
                <RowsSkeleton label="Loading stat contexts" rows={6} rowClassName="h-14 w-full" />
              }
              isEmpty={!effectiveWeekId || contexts.data?.games.length === 0}
              emptyMessage={
                effectiveWeekId
                  ? "No games synced for this week."
                  : "No weeks synced for this season."
              }
            >
              <ul className="flex flex-col gap-3">
                {contexts.data?.games.map((game) => (
                  <ContextRow key={game.gameId} game={game} />
                ))}
              </ul>
            </QueryState>
          </div>
        </QueryState>
      </CardContent>
    </Card>
  );
}

function ContextRow({ game }: { game: AdminNflGameStatContext }) {
  const [editOpen, setEditOpen] = useState(false);
  const block = game.context;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-sm font-medium text-foreground"
          title={`${game.awayTeam.name} @ ${game.homeTeam.name}`}
        >
          {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
        </p>
        {block !== null && block.overriddenAt !== null && (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
            Overridden
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">kickoff {formatDateTime(game.kickoffAt)}</p>

      {block ? (
        <>
          <div className="flex flex-col gap-1 text-xs text-foreground">
            <ResolvedField
              label={game.awayTeam.abbreviation}
              resolved={sideSummary(block.effective.away)}
              provider={sideSummary(block.payload.away)}
              showProvider={sideOverridden(block.overridePayload?.away)}
            />
            <ResolvedField
              label={game.homeTeam.abbreviation}
              resolved={sideSummary(block.effective.home)}
              provider={sideSummary(block.payload.home)}
              showProvider={sideOverridden(block.overridePayload?.home)}
            />
          </div>

          <p className="text-xs text-muted-foreground">updated {formatDateTime(block.updatedAt)}</p>

          {/* Same open/remount contract as the sibling browsers — the form
              re-seeds when the stored override layer changes server-side. */}
          <details open={editOpen} onToggle={(event) => setEditOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer text-xs text-muted-foreground select-none">
              Edit override
            </summary>
            {editOpen && (
              <NflStatContextOverrideForm
                key={JSON.stringify(nflContextOverrideFormSeed(block))}
                game={game}
                block={block}
              />
            )}
          </details>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No context synced for this game yet — nothing to correct until the stats sync writes one.
        </p>
      )}
    </li>
  );
}
