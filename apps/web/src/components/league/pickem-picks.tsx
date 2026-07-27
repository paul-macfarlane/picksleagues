import { useEffect, useState } from "react";
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
import { toast } from "sonner";
import { useSubmitPicks, useWeekPicks, useWeekSlate } from "@/api/picks";
import { formatDateTime } from "@/lib/format";
import { gameStatusLabel } from "@/lib/game";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Home-relative spread, flipped for the away side (spec §ATS) — the sign a
// member reads next to the team they'd be picking, not the raw stored number.
function spreadLabel(spread: number | null, side: "home" | "away"): string | null {
  if (spread === null) return null;
  const value = side === "home" ? spread : -spread;
  return value > 0 ? `+${value}` : `${value}`;
}

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

  useEffect(() => {
    if (slate.isError || picks.isError) {
      toast.error("Couldn't load this week's picks — please try again.");
    }
  }, [slate.isError, picks.isError]);

  if (slate.isPending || picks.isPending) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading this week…</p>;
  }

  if (slate.isError || picks.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this week.</p>
        <Button
          variant="outline"
          onClick={() => {
            void slate.refetch();
            void picks.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (slate.data.games.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No games synced for this week yet.
      </p>
    );
  }

  const viewer = picks.data.members.find((member) => member.isViewer);

  return (
    <PickemWeekEditor
      // Remounted per week (and dropped/re-seeded on any other week change)
      // so a stale in-progress selection from a previously viewed week can
      // never bleed into this one.
      key={weekId}
      leagueId={leagueId}
      weekId={weekId}
      pickType={pickType}
      slate={slate.data}
      picksAllowed={picks.data.picksAllowed}
      viewerPicks={viewer?.picks ?? []}
    />
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
  // matches what the member actually holds.
  const lockedPickByGameId = new Map<string, PickemPick>();
  const gameById = new Map(slate.games.map((game) => [game.id, game]));
  for (const pick of viewerPicks) {
    const game = gameById.get(pick.gameId);
    if (!game || game.locked || !game.pickable) {
      lockedPickByGameId.set(pick.gameId, pick);
    }
  }

  const heldCount = lockedPickByGameId.size + selections.size;
  const atCap = heldCount >= picksAllowed;
  const dirty = !selectionsEqual(seed, selections);

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
        <ul className="flex flex-col gap-3">
          {slate.games.map((game) => {
            const currentSelection = selections.get(game.id);
            const wouldAddNew = currentSelection === undefined;
            return (
              <GameRow
                key={game.id}
                game={game}
                pickType={pickType}
                selectedSide={currentSelection}
                lockedPick={lockedPickByGameId.get(game.id)}
                buttonsDisabled={wouldAddNew && atCap}
                onToggle={(side) => toggle(game.id, side)}
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
  game,
  pickType,
  selectedSide,
  lockedPick,
  buttonsDisabled,
  onToggle,
}: {
  game: SlateGame;
  pickType: PickType;
  selectedSide: PickSide | undefined;
  lockedPick: PickemPick | undefined;
  buttonsDisabled: boolean;
  onToggle: (side: PickSide) => void;
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
        <p className="text-xs text-muted-foreground">
          {lockedPick
            ? `Your pick: ${
                lockedPick.side === PICK_SIDE.HOME
                  ? game.homeTeam.abbreviation
                  : game.awayTeam.abbreviation
              }`
            : "No pick"}
        </p>
      )}
    </li>
  );
}
