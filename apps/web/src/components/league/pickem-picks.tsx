import { useState } from "react";
import {
  PICK_SIDE,
  PICK_TYPE,
  type PickSide,
  type PickType,
  type PickemPick,
  type PickemPickSubmission,
  type SlateGame,
  type WeekSlateResponse,
} from "@picksleagues/schemas";
import { useSubmitPicks, useWeekPicks, useWeekSlate } from "@/api/picks";
import { formatDateTime } from "@/lib/format";
import { gameStatusLabel, spreadLabel } from "@/lib/game";
import { useErrorToast } from "@/lib/use-error-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/query-state";
import { SubstitutePickDialog } from "@/components/league/substitute-pick-dialog";

// Only games that are still replaceable (spec/ADR-0015: unlocked and
// pickable) seed the editable selection — a locked, cancelled/moved, or
// week-moved pick is retained server-side automatically and must never be
// re-submitted, so it never enters this map.
function hydrateSelections(slate: WeekSlateResponse, viewerPicks: PickemPick[]) {
  const selections = new Map<string, PickSide>();
  const gameById = new Map(slate.games.map((game) => [game.id, game]));
  for (const pick of viewerPicks) {
    const game = gameById.get(pick.gameId);
    if (game && !game.locked && game.pickable) {
      selections.set(pick.gameId, pick.side);
    }
  }
  return selections;
}

function selectionsEqual(a: Map<string, PickSide>, b: Map<string, PickSide>): boolean {
  if (a.size !== b.size) return false;
  for (const [gameId, side] of a) {
    if (b.get(gameId) !== side) return false;
  }
  return true;
}

export function PickemPicks({
  leagueId,
  weekId,
  pickType,
}: {
  leagueId: string;
  weekId: string;
  pickType: PickType;
}) {
  const slate = useWeekSlate(weekId);
  const picks = useWeekPicks(leagueId, weekId);

  useErrorToast(
    slate.isError || picks.isError,
    "Couldn't load this week's picks — please try again.",
  );

  return (
    <QueryState
      isPending={slate.isPending || picks.isPending}
      pendingMessage="Loading this week…"
      isError={slate.isError || picks.isError}
      onRetry={() => {
        void slate.refetch();
        void picks.refetch();
      }}
      errorMessage="Couldn't load this week."
      isEmpty={slate.data?.games.length === 0}
      emptyMessage="No games synced for this week yet."
    >
      {slate.data && picks.data && (
        <PickemWeekEditor
          // Remounted per week (and dropped/re-seeded on any other week
          // change) so a stale in-progress selection from a previously
          // viewed week can never bleed into this one.
          key={weekId}
          leagueId={leagueId}
          weekId={weekId}
          pickType={pickType}
          slate={slate.data}
          picksAllowed={picks.data.picksAllowed}
          viewerPicks={picks.data.members.find((member) => member.isViewer)?.picks ?? []}
        />
      )}
    </QueryState>
  );
}

function PickemWeekEditor({
  leagueId,
  weekId,
  pickType,
  slate,
  picksAllowed,
  viewerPicks,
}: {
  leagueId: string;
  weekId: string;
  pickType: PickType;
  slate: WeekSlateResponse;
  picksAllowed: number;
  viewerPicks: PickemPick[];
}) {
  const submit = useSubmitPicks(leagueId, weekId);

  // Seeded once at mount (per-week remount above) — a background refetch
  // (e.g. the spread_stale recovery path re-pulling this same slate) must
  // not silently discard picks the member is still deciding on, same
  // non-re-seeding rationale as the sim fixture editor.
  const [seed, setSeed] = useState(() => hydrateSelections(slate, viewerPicks));
  const [selections, setSelections] = useState<Map<string, PickSide>>(() => new Map(seed));

  // Retained picks (locked, or on a now-unpickable/moved-out game) count
  // against the member's cap but can never be edited from this endpoint
  // (ADR-0015) — shown read-only rather than omitted, so "5 picks in"
  // matches what the member actually holds. `pushed` marks the subset the
  // repick endpoint can act on (the game left the week, or is cancelled/moved
  // within it) — a plain locked pick (its game simply kicked off) is retained
  // too but offers no substitution.
  const gameById = new Map(slate.games.map((game) => [game.id, game]));
  const retainedPickByGameId = new Map<string, { pick: PickemPick; pushed: boolean }>();
  for (const pick of viewerPicks) {
    const game = gameById.get(pick.gameId);
    const pushed = !game || !game.pickable;
    if (!game || game.locked || !game.pickable) {
      retainedPickByGameId.set(pick.gameId, { pick, pushed });
    }
  }

  const heldCount = retainedPickByGameId.size + selections.size;
  const atCap = heldCount >= picksAllowed;
  const dirty = !selectionsEqual(seed, selections);

  // A pushed pick may be substituted for any of the week's currently
  // available games (spec §Cancellations) — unstarted, pickable, and not
  // already held. "Held" includes both committed picks and anything the
  // member has tentatively toggled in this editor but not yet saved, so the
  // substitute flow can never offer a game the batch save would also submit.
  const heldGameIds = new Set<string>([
    ...viewerPicks.map((pick) => pick.gameId),
    ...selections.keys(),
  ]);
  const eligibleReplacementGames = slate.games.filter(
    (game) => !game.locked && game.pickable && !heldGameIds.has(game.id),
  );

  // Pushed picks whose game moved to a different week entirely aren't in this
  // slate at all (ADR-0015), so they never render via the games list below —
  // they get their own row here instead.
  const pushedOutOfWeekPicks = [...retainedPickByGameId.entries()]
    .filter(([gameId, retained]) => retained.pushed && !gameById.has(gameId))
    .map(([, retained]) => retained.pick);

  function toggle(gameId: string, side: PickSide) {
    setSelections((prev) => {
      const next = new Map(prev);
      if (next.get(gameId) === side) {
        next.delete(gameId);
      } else {
        next.set(gameId, side);
      }
      return next;
    });
  }

  // A substitution writes a new pick server-side without going through this
  // editor's own save — sync both maps so the replacement shows as held
  // immediately (heldCount, the "N / M picked" count, and the game's row)
  // rather than waiting on a remount. Written into `seed` too so the editor
  // doesn't read as dirty for a pick the member didn't touch.
  function handleSubstituted(gameId: string, side: PickSide) {
    setSelections((prev) => new Map(prev).set(gameId, side));
    setSeed((prev) => new Map(prev).set(gameId, side));
  }

  function handleSubmit() {
    const payload: PickemPickSubmission[] = slate.games
      .filter((game) => selections.has(game.id))
      .map((game) => ({
        gameId: game.id,
        side: selections.get(game.id) as PickSide,
        // Every submitted pick carries the spread currently shown for that
        // game — the write path re-prices every unstarted pick on every
        // edit (ADR-0015); SU leagues send null (spec §Pick Type).
        spread: pickType === PICK_TYPE.AGAINST_THE_SPREAD ? game.spread : null,
      }));
    submit.mutate(payload, {
      onSuccess: (data) => {
        if (data) setSeed(new Map(selections));
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{slate.label}</CardTitle>
        <CardDescription>
          {heldCount} / {picksAllowed} picked
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pushedOutOfWeekPicks.length > 0 && (
          <ul className="flex flex-col gap-3">
            {pushedOutOfWeekPicks.map((pick) => (
              <li key={pick.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Pick moved out of this week</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Push
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  That game moved to a different week, so this pick resolved as a push.
                </p>
                <SubstitutePickDialog
                  leagueId={leagueId}
                  weekId={weekId}
                  pickType={pickType}
                  replacePickId={pick.id}
                  eligibleGames={eligibleReplacementGames}
                  onSubstituted={handleSubstituted}
                />
              </li>
            ))}
          </ul>
        )}

        <ul className="flex flex-col gap-3">
          {slate.games.map((game) => {
            const currentSelection = selections.get(game.id);
            const wouldAddNew = currentSelection === undefined;
            return (
              <GameRow
                key={game.id}
                leagueId={leagueId}
                weekId={weekId}
                game={game}
                pickType={pickType}
                selectedSide={currentSelection}
                retained={retainedPickByGameId.get(game.id)}
                eligibleReplacementGames={eligibleReplacementGames}
                buttonsDisabled={wouldAddNew && atCap}
                onToggle={(side) => toggle(game.id, side)}
                onSubstituted={handleSubstituted}
              />
            );
          })}
        </ul>
        <Button className="self-start" disabled={submit.isPending || !dirty} onClick={handleSubmit}>
          Save picks
        </Button>
      </CardContent>
    </Card>
  );
}

function GameRow({
  leagueId,
  weekId,
  game,
  pickType,
  selectedSide,
  retained,
  eligibleReplacementGames,
  buttonsDisabled,
  onToggle,
  onSubstituted,
}: {
  leagueId: string;
  weekId: string;
  game: SlateGame;
  pickType: PickType;
  selectedSide: PickSide | undefined;
  retained: { pick: PickemPick; pushed: boolean } | undefined;
  eligibleReplacementGames: SlateGame[];
  buttonsDisabled: boolean;
  onToggle: (side: PickSide) => void;
  onSubstituted: (gameId: string, side: PickSide) => void;
}) {
  const showSpread = pickType === PICK_TYPE.AGAINST_THE_SPREAD;
  // ATS leagues can't submit a pick with no number to accept — the write path
  // 409s (`spread_stale`, "no current number means there is nothing to
  // accept") for every attempt until the odds sync lands, so this is guarded
  // client-side rather than left to surface as a confusing repeat failure.
  const noLineYet = showSpread && game.spread === null;
  const editable = !game.locked && game.pickable && !noLineYet;
  const awaySpread = showSpread ? spreadLabel(game.spread, "away") : null;
  const homeSpread = showSpread ? spreadLabel(game.spread, "home") : null;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-sm font-medium text-foreground"
          title={`${game.awayTeam.name} @ ${game.homeTeam.name}`}
        >
          {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
        </p>
        {!game.pickable && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {gameStatusLabel(game.status)}
          </span>
        )}
        {game.pickable && game.locked && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Locked
          </span>
        )}
        {game.pickable && !game.locked && noLineYet && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            No line yet
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Kickoff {formatDateTime(game.kickoffAt)}</p>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={selectedSide === PICK_SIDE.AWAY ? "default" : "outline"}
          aria-pressed={selectedSide === PICK_SIDE.AWAY}
          disabled={!editable || buttonsDisabled}
          onClick={() => onToggle(PICK_SIDE.AWAY)}
        >
          {game.awayTeam.abbreviation}
          {awaySpread && ` ${awaySpread}`}
        </Button>
        <Button
          type="button"
          variant={selectedSide === PICK_SIDE.HOME ? "default" : "outline"}
          aria-pressed={selectedSide === PICK_SIDE.HOME}
          disabled={!editable || buttonsDisabled}
          onClick={() => onToggle(PICK_SIDE.HOME)}
        >
          {game.homeTeam.abbreviation}
          {homeSpread && ` ${homeSpread}`}
        </Button>
      </div>

      {!editable && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {retained
              ? `Your pick: ${
                  retained.pick.side === PICK_SIDE.HOME
                    ? game.homeTeam.abbreviation
                    : game.awayTeam.abbreviation
                }`
              : "No pick"}
          </p>
          {/* Only a pushed pick (spec §Cancellations) gets a substitute offer
              — a plain locked pick (the game simply kicked off) is retained
              too but stays as-is, so `pushed` gates this rather than `retained`
              alone. */}
          {retained?.pushed && (
            <>
              <p className="text-xs text-muted-foreground">
                This game was cancelled or moved, so the pick resolved as a push — your other picks
                are unaffected.
              </p>
              <SubstitutePickDialog
                leagueId={leagueId}
                weekId={weekId}
                pickType={pickType}
                replacePickId={retained.pick.id}
                eligibleGames={eligibleReplacementGames}
                onSubstituted={onSubstituted}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}
