import { useState } from "react";
import {
  PICK_TYPE,
  type PickemPickSide,
  type PickType,
  type PickemPick,
  type PickemPickSubmission,
  type WeekSlateResponse,
} from "@picksleagues/schemas";
import { useSubmitPicks, useWeekPicks } from "@/api/pickem";
import { useWeekSlate } from "@/api/weeks";
import { useErrorToast } from "@/lib/use-error-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/query-state";
import { GameRow } from "@/components/league/pickem-game-row";
import { PickemSubstituteDialog } from "@/components/league/pickem-substitute-dialog";

// Only games that are still replaceable (spec/ADR-0015: unlocked and
// pickable) seed the editable selection — a locked, cancelled/moved, or
// week-moved pick is retained server-side automatically and must never be
// re-submitted, so it never enters this map.
function hydrateSelections(slate: WeekSlateResponse, viewerPicks: PickemPick[]) {
  const selections = new Map<string, PickemPickSide>();
  const gameById = new Map(slate.games.map((game) => [game.id, game]));
  for (const pick of viewerPicks) {
    const game = gameById.get(pick.gameId);
    if (game && !game.locked && game.pickable) {
      selections.set(pick.gameId, pick.side);
    }
  }
  return selections;
}

function selectionsEqual(a: Map<string, PickemPickSide>, b: Map<string, PickemPickSide>): boolean {
  if (a.size !== b.size) return false;
  for (const [gameId, side] of a) {
    if (b.get(gameId) !== side) return false;
  }
  return true;
}

// The sticky action bar's progress copy (feedback: submitting a 16-game
// slate shouldn't require scrolling to find the count) — a pure formatter so
// the exact phrasing is pinned by a test rather than re-typed at the call
// site.
export function pickProgressLabel(heldCount: number, picksAllowed: number): string {
  return `${heldCount} of ${picksAllowed} picks`;
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
  const [selections, setSelections] = useState<Map<string, PickemPickSide>>(() => new Map(seed));

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

  function toggle(gameId: string, side: PickemPickSide) {
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
  function handleSubstituted(gameId: string, side: PickemPickSide) {
    setSelections((prev) => new Map(prev).set(gameId, side));
    setSeed((prev) => new Map(prev).set(gameId, side));
  }

  function handleSubmit() {
    const payload: PickemPickSubmission[] = slate.games
      .filter((game) => selections.has(game.id))
      .map((game) => ({
        gameId: game.id,
        side: selections.get(game.id) as PickemPickSide,
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
    <>
      <Card>
        <CardHeader>
          <CardTitle>{slate.label}</CardTitle>
          {/* Progress lives in the action bar, which is always on screen —
              repeating the same count here in a second phrasing would only
              give it somewhere to drift, and this copy scrolls away anyway. */}
          <CardDescription>Each pick locks at its own kickoff.</CardDescription>
        </CardHeader>
        {/* Bottom padding clears the fixed action bar below so it never
            covers the last game row's controls when scrolled to the bottom
            (verified at 375px). */}
        <CardContent className="flex flex-col gap-4 pb-24">
          {pushedOutOfWeekPicks.length > 0 && (
            <ul className="flex flex-col gap-3">
              {pushedOutOfWeekPicks.map((pick) => (
                <li
                  key={pick.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      Pick moved out of this week
                    </p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Push
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    That game moved to a different week, so this pick resolved as a push.
                  </p>
                  <PickemSubstituteDialog
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
        </CardContent>
      </Card>

      {/* Sticky action bar (feedback: submitting a 16-game slate shouldn't
          require scrolling to the bottom to find the button). `fixed`, not
          CSS `sticky` — Card sets `overflow-hidden` for its rounded corners,
          and any ancestor with overflow other than visible clips/breaks a
          sticky descendant, whereas `fixed` escapes ancestor layout
          entirely and anchors straight to the viewport, which is exactly
          what we want since the document is the app's only scroll container
          (no ancestor here sets a transform/filter that would trap it).
          z-20 stays under the tab bar (z-30) and header (z-40) per
          routes/_authed.tsx's layering comment, and well under overlay
          portals (z-50). */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="text-sm text-muted-foreground">
            {pickProgressLabel(heldCount, picksAllowed)}
            {dirty && <span className="text-foreground"> · unsaved</span>}
          </p>
          {/* Async-button rule: disabled in place while pending, label never
              changes — outcome feedback is the toast the mutation already
              raises on success/error. */}
          <Button disabled={submit.isPending || !dirty} onClick={handleSubmit}>
            Save picks
          </Button>
        </div>
      </div>
    </>
  );
}
