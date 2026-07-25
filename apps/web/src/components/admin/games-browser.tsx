import { useState } from "react";
import { ADMIN_ODDS_SNAPSHOT_LIMIT, SPORT, type AdminGame } from "@picksleagues/schemas";
import { useAdminGameOdds, useAdminGames, useAdminSeasons } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { gameStatusLabel } from "@/lib/game";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LabeledSelect } from "@/components/labeled-select";
import { AdminQueryState } from "@/components/admin/query-state";

// `LabeledSelect` renders one label string for both the closed trigger and
// the open list — a single source keeps a selected provisional season
// readable as provisional even once the list closes, which is the exact
// thing this browser exists to surface.
function seasonLabel(season: { year: number; provisional: boolean }) {
  return `${season.year}${season.provisional ? " (provisional)" : ""}`;
}

// Empty (not a placeholder dash) when unscored: this renders after the status
// word, and "Scheduled –" reads as a truncated line rather than "no score yet".
function scoreText(away: number | null, home: number | null) {
  return away === null || home === null ? "" : ` ${away}–${home}`;
}

function isOverridden(game: AdminGame) {
  return (
    game.overrideKickoffAt !== null ||
    game.overrideStatus !== null ||
    game.overrideHomeScore !== null ||
    game.overrideAwayScore !== null ||
    game.overrideSpread !== null
  );
}

/**
 * Selection lives in the URL (owned by the route), not in state: a specific
 * week's slate is worth sharing while debugging a sync, and it survives a
 * refresh. Both params are optional — an absent one derives to the newest
 * season and its earliest week (seasons arrive newest-first, weeks
 * chronological), so the browser opens on something useful with no effect-driven
 * setState cascade.
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
  const seasons = useAdminSeasons(SPORT.NFL);

  const all = seasons.data?.seasons ?? [];
  // A week identifies its own season, so an inbound link needs only `weekId`
  // and `seasonId` is the fallback for "a season is chosen but no week yet"
  // (which is also how a season with zero weeks stays selected).
  const selectedSeason =
    all.find((season) => season.weeks.some((week) => week.id === weekId)) ??
    all.find((season) => season.id === seasonId) ??
    all[0];
  const effectiveWeekId = weekId ?? selectedSeason?.weeks[0]?.id;
  const games = useAdminGames(effectiveWeekId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Games</CardTitle>
        <CardDescription>
          Provider, override, and resolved values for a week&apos;s games.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AdminQueryState
          isPending={seasons.isPending}
          isError={seasons.isError}
          onRetry={() => seasons.refetch()}
          errorMessage="Couldn't load seasons."
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
            <AdminQueryState
              isPending={Boolean(effectiveWeekId) && games.isPending}
              isError={games.isError}
              onRetry={() => games.refetch()}
              errorMessage="Couldn't load games."
              isEmpty={!effectiveWeekId || games.data?.games.length === 0}
              emptyMessage={
                effectiveWeekId
                  ? "No games synced for this week."
                  : "No weeks synced for this season."
              }
            >
              <ul className="flex flex-col gap-3">
                {games.data?.games.map((game) => (
                  <GameRow key={game.id} game={game} />
                ))}
              </ul>
            </AdminQueryState>
          </div>
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}

function ResolvedField({
  label,
  resolved,
  provider,
  showProvider,
}: {
  label: string;
  resolved: string;
  provider: string;
  showProvider: boolean;
}) {
  return (
    <span>
      {label} {resolved}
      {showProvider && <span className="text-muted-foreground"> · provider: {provider}</span>}
    </span>
  );
}

function GameRow({ game }: { game: AdminGame }) {
  const overridden = isOverridden(game);
  const [oddsOpen, setOddsOpen] = useState(false);
  const odds = useAdminGameOdds(game.id, oddsOpen);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-sm font-medium text-foreground"
          title={`${game.awayTeam.name} @ ${game.homeTeam.name}`}
        >
          {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
        </p>
        {overridden && (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
            Overridden
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1 text-xs text-foreground">
        <ResolvedField
          label="Kickoff"
          resolved={formatDateTime(game.effectiveKickoffAt)}
          provider={formatDateTime(game.kickoffAt)}
          showProvider={game.overrideKickoffAt !== null}
        />
        <ResolvedField
          label="Status"
          resolved={`${gameStatusLabel(game.effectiveStatus)}${scoreText(
            game.effectiveAwayScore,
            game.effectiveHomeScore,
          )}`}
          provider={`${gameStatusLabel(game.status)}${scoreText(game.awayScore, game.homeScore)}`}
          showProvider={
            game.overrideStatus !== null ||
            game.overrideHomeScore !== null ||
            game.overrideAwayScore !== null
          }
        />
        <ResolvedField
          label="Spread"
          resolved={game.effectiveSpread === null ? "no line" : String(game.effectiveSpread)}
          provider={game.latestSpread === null ? "no line" : String(game.latestSpread)}
          showProvider={game.overrideSpread !== null}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Spread captured{" "}
        {game.latestSpreadCapturedAt ? formatDateTime(game.latestSpreadCapturedAt) : "never"} ·
        provider game id {game.providerGameId}
      </p>

      <details open={oddsOpen} onToggle={(event) => setOddsOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs text-muted-foreground select-none">
          Odds history
        </summary>
        {oddsOpen && (
          <div className="mt-2">
            <AdminQueryState
              isPending={odds.isPending}
              isError={odds.isError}
              onRetry={() => odds.refetch()}
              errorMessage="Couldn't load odds history."
              isEmpty={odds.data?.snapshots.length === 0}
              emptyMessage="No odds captured yet."
            >
              <ul className="flex flex-col gap-1">
                {odds.data?.snapshots.map((snapshot) => (
                  <li
                    key={snapshot.id}
                    className="flex justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span>{snapshot.spread}</span>
                    <span>{formatDateTime(snapshot.capturedAt)}</span>
                  </li>
                ))}
              </ul>
              {odds.data?.snapshots.length === ADMIN_ODDS_SNAPSHOT_LIMIT && (
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Only the most recent {ADMIN_ODDS_SNAPSHOT_LIMIT} snapshots are shown.
                </p>
              )}
            </AdminQueryState>
          </div>
        )}
      </details>
    </li>
  );
}
