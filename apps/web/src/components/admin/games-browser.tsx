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

export function GamesBrowser() {
  const seasons = useAdminSeasons(SPORT.NFL);
  // `undefined` means "no explicit choice yet" — derived below to the newest
  // season / its earliest week (seasons arrive newest-first, weeks
  // chronological) so the browser opens on the current week without an
  // effect-driven setState render cascade.
  const [seasonId, setSeasonId] = useState<string | undefined>();
  const [weekId, setWeekId] = useState<string | undefined>();

  const effectiveSeasonId = seasonId ?? seasons.data?.seasons[0]?.id;
  const selectedSeason = seasons.data?.seasons.find((season) => season.id === effectiveSeasonId);
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
          isEmpty={seasons.data?.seasons.length === 0}
          emptyMessage="No seasons synced yet."
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <LabeledSelect
                id="games-browser-season"
                label="Season"
                value={effectiveSeasonId ?? null}
                onValueChange={(next) => {
                  setSeasonId(next);
                  // Reset to the newly selected season's first week rather
                  // than carrying over a week id from a different season.
                  setWeekId(undefined);
                }}
                options={(seasons.data?.seasons ?? []).map((season) => ({
                  value: season.id,
                  label: seasonLabel(season),
                }))}
              />
              <LabeledSelect
                id="games-browser-week"
                label="Week"
                value={effectiveWeekId ?? null}
                onValueChange={setWeekId}
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
