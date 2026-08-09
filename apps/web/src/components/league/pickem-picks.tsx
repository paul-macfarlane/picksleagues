import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  PICK_TYPE,
  requiredPickemPickCount,
  type PickemPick,
  type PickemPickSide,
  type PickemPickSubmission,
  type PickType,
  type SlateGame,
  type WeekSlateResponse,
} from "@picksleagues/schemas";
import { useSubmitPicks, useWeekPicks } from "@/api/pickem";
import { useWeekSlate } from "@/api/weeks";
import { isClosedToPicks, spreadSourceCredit } from "@/lib/game";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { SheetGameRow, SubmittedPickRow } from "@/components/league/pickem-game-row";

/**
 * Narrows a selection map to the games the sheet may still submit — unlocked
 * and pickable.
 *
 * Applied on **every** render, not only when seeding at mount. Games lock one
 * at a time through a Sunday and a background slate refetch brings that in
 * without remounting the sheet, so a selection made while a game was open
 * outlives the game's own pickability. Leaving it in place would submit a
 * locked game into the write path's lock guard — and under ADR-0018 that refusal
 * costs the member the whole week's submission, not one pick.
 *
 * The required set shrinks by the same rule at the same moment
 * (`requiredPickemPickCount`), so a sheet that was complete before a kickoff is
 * still complete after it.
 */
export function openSelections(
  games: Pick<SlateGame, "id" | "locked" | "pickable">[],
  selections: Map<string, PickemPickSide>,
): Map<string, PickemPickSide> {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const open = new Map<string, PickemPickSide>();
  for (const [gameId, side] of selections) {
    const game = gameById.get(gameId);
    if (game && !isClosedToPicks(game)) open.set(gameId, side);
  }
  return open;
}

/**
 * The sticky action bar's progress copy (feedback: submitting a 16-game
 * slate shouldn't require scrolling to find the count) — a pure formatter so
 * the exact phrasing is pinned by a test rather than re-typed at the call
 * site.
 */
export function pickProgressLabel(heldCount: number, picksAllowed: number): string {
  return `${heldCount} of ${picksAllowed} picks`;
}

/**
 * The member's own week (spec §Screens: pick entry has two states).
 *
 * Which state it is in is a fact about the server, not this component: under
 * ADR-0018 a member holds either no picks for a week or the whole submission,
 * so holding any pick *is* having submitted. There is no third state and no
 * partial sheet to resume.
 */
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
  const viewerPicks = picks.data?.members.find((member) => member.isViewer)?.picks ?? [];

  return (
    <QueryState
      isPending={slate.isPending || picks.isPending}
      pendingFallback={
        <RowsSkeleton label="Loading this week" rows={4} rowClassName="h-28 w-full" />
      }
      isError={slate.isError || picks.isError}
      onRetry={() => {
        void slate.refetch();
        void picks.refetch();
      }}
      errorMessage="Couldn't load this week."
      isEmpty={(slate.data?.games.length ?? 0) === 0}
      emptyMessage="No games synced for this week yet."
    >
      {slate.data &&
        picks.data &&
        (viewerPicks.length > 0 ? (
          <SubmittedWeek slate={slate.data} pickType={pickType} viewerPicks={viewerPicks} />
        ) : (
          <PickSheet
            // Remounted per week (and dropped/re-seeded on any other week
            // change) so a stale in-progress selection from a previously
            // viewed week can never bleed into this one.
            key={weekId}
            leagueId={leagueId}
            weekId={weekId}
            pickType={pickType}
            slate={slate.data}
            picksAllowed={picks.data.picksAllowed}
          />
        ))}
    </QueryState>
  );
}

/**
 * The week in review: the member's submission, read-only and final.
 *
 * Ordered by the slate rather than by the picks array so the rows read in
 * kickoff order like the sheet they were assembled in. Only the games they
 * picked are shown — the rest of the slate is not theirs to scan past
 * (spec §Screens).
 */
function SubmittedWeek({
  slate,
  pickType,
  viewerPicks,
}: {
  slate: WeekSlateResponse;
  pickType: PickType;
  viewerPicks: PickemPick[];
}) {
  const pickByGameId = new Map(viewerPicks.map((pick) => [pick.gameId, pick]));
  const picked = slate.games.flatMap((game) => {
    const pick = pickByGameId.get(game.id);
    return pick ? [{ game, pick }] : [];
  });
  const credit = spreadSourceCredit(
    picked.map(({ game }) => game),
    pickType,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{slate.label}</CardTitle>
        <CardDescription>
          {`${picked.length} ${picked.length === 1 ? "pick" : "picks"} in. This week is submitted — picks can't be changed.`}
        </CardDescription>
        {credit && (
          <p data-testid="spread-source-credit" className="text-xs text-muted-foreground/70">
            {credit}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3">
          {picked.map(({ game, pick }) => (
            <SubmittedPickRow key={pick.id} game={game} pick={pick} pickType={pickType} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * The unsubmitted week: a local sheet the member assembles, then commits once.
 *
 * Nothing here reaches the server until Submit, and Submit is confirmed, because
 * the submission is irreversible (ADR-0018 decision 1) — there is no draft to
 * save and no second attempt to correct one.
 */
function PickSheet({
  leagueId,
  weekId,
  pickType,
  slate,
  picksAllowed,
}: {
  leagueId: string;
  weekId: string;
  pickType: PickType;
  slate: WeekSlateResponse;
  picksAllowed: number;
}) {
  const submit = useSubmitPicks(leagueId, weekId);
  const [storedSelections, setStoredSelections] = useState<Map<string, PickemPickSide>>(
    () => new Map(),
  );

  // Re-narrowed against the *current* slate on every render rather than trusted
  // to have stayed valid since it was made — see `openSelections`.
  const selections = openSelections(slate.games, storedSelections);

  // The same rule the API validates the submission with, from the same function
  // in `packages/schemas` — the sheet must never disagree with the write path
  // about what "complete" means, including on which games are excluded from the
  // set. `locked` arrives server-computed on the slate (arch D11), so this is
  // not a browser-clock derivation: under the simulator the browser sits at a
  // different instant entirely.
  const required = requiredPickemPickCount(picksAllowed, slate.games, pickType);
  const complete = required > 0 && selections.size === required;

  // Only what the member can still pick (spec §Screens). A game that kicked off
  // without them is forgone and scores nothing (ADR-0018 decision 2), so it is
  // not a row on a sheet they are assembling.
  const openGames = slate.games.filter((game) => !isClosedToPicks(game));
  // An ATS game with no posted line is shown but not pickable, and is not part
  // of the required set either — so the sheet is completable without it. Saying
  // so is a courtesy, not an obstacle: without it the member counts more rows
  // than the target and reads the difference as a bug.
  const noLineCount =
    pickType === PICK_TYPE.AGAINST_THE_SPREAD
      ? openGames.filter((game) => game.spread === null).length
      : 0;
  // Reachable only in an ATS week where *every* open game is still unpriced: a
  // required set of zero with games on screen means the odds sync hasn't landed
  // yet, not that the member did anything. The action bar stays off rather than
  // offering a Submit that could never enable.
  const awaitingLines = openGames.length > 0 && required === 0;
  const credit = spreadSourceCredit(openGames, pickType);

  function toggle(gameId: string, side: PickemPickSide) {
    setStoredSelections((prev) => {
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
    // Built by lookup-then-narrow rather than filter-then-assert: a `filter`
    // teaches TypeScript nothing about the `get` that follows it, so the only
    // way to keep the shape was a cast that would have outlived any future
    // change to the selection map.
    const payload: PickemPickSubmission[] = slate.games.flatMap((game) => {
      const side = selections.get(game.id);
      if (side === undefined) return [];
      return [
        {
          gameId: game.id,
          side,
          // The one moment ATS spreads are accepted, on the whole set at once
          // (spec §ATS spread acceptance) — there is no second write in which
          // any of them could be re-priced. SU leagues send null.
          spread: pickType === PICK_TYPE.AGAINST_THE_SPREAD ? game.spread : null,
        },
      ];
    });
    submit.mutate(payload);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{slate.label}</CardTitle>
          <CardDescription>
            {openGames.length === 0
              ? "This week is closed."
              : awaitingLines
                ? "No spreads are posted for this week yet — picks open as soon as the lines are up."
                : `Pick ${required} ${required === 1 ? "game" : "games"}, then submit. Your picks are final once submitted, and each locks at its own kickoff.`}
          </CardDescription>
          {credit && (
            <p data-testid="spread-source-credit" className="text-xs text-muted-foreground/70">
              {credit}
            </p>
          )}
          <p className="text-xs">
            <Link
              to="/rules/pickem"
              className="text-muted-foreground underline hover:text-foreground"
            >
              Full Pick&apos;em rules
            </Link>
          </p>
        </CardHeader>
        {/* Bottom padding clears the fixed action bar below so it never
            covers the last game row's controls when scrolled to the bottom
            (verified at 375px) — and is dropped with the bar, since the
            reserved gap reads as a broken layout with nothing in it. */}
        <CardContent
          className={cn("flex flex-col gap-4", openGames.length > 0 && !awaitingLines && "pb-24")}
        >
          {/* Reachable once the week has closed around a member who submitted
              nothing. Without it the card renders as an empty box, which reads
              as a load failure rather than an answer (spec §Screens). */}
          {openGames.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You didn&apos;t make any picks this week.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {openGames.map((game) => {
                const selectedSide = selections.get(game.id);
                return (
                  <SheetGameRow
                    key={game.id}
                    game={game}
                    pickType={pickType}
                    selectedSide={selectedSide}
                    buttonsDisabled={selectedSide === undefined && selections.size >= required}
                    onToggle={(side) => toggle(game.id, side)}
                  />
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Sticky action bar (feedback: submitting a 16-game slate shouldn't
          require scrolling to the bottom to find the button). `fixed`, not CSS
          `sticky` — Card sets `overflow-hidden` for its rounded corners, and any
          ancestor with overflow other than visible clips/breaks a sticky
          descendant, whereas `fixed` escapes ancestor layout entirely and
          anchors straight to the viewport, which is exactly what we want since
          the document is the app's only scroll container (no ancestor here sets
          a transform/filter that would trap it). z-20 stays under the tab bar
          (z-30) and header (z-40) per routes/_authed.tsx's layering comment, and
          well under overlay portals (z-50). */}
      {openGames.length > 0 && !awaitingLines && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
          {/* Stacks at phone width: the no-line explanation needs a line of its
              own at 375px. Above `sm` there is room for the original single
              line. */}
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex flex-col">
              <p className="text-sm text-muted-foreground">
                {pickProgressLabel(selections.size, required)}
              </p>
              {/* Reconciles the count with the rows: the member can see more
                  games on screen than the target asks for, and this names the
                  difference. Deliberately not a warning — the sheet is
                  completable without them, so this reports a fact rather than an
                  obstacle. */}
              {noLineCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {noLineCount === 1
                    ? "One game has no spread posted yet, so it isn't part of this week's set."
                    : `${noLineCount} games have no spread posted yet, so they aren't part of this week's set.`}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              {/* The irreversibility confirmation ADR-0018 decision 1 requires,
                  in the same AlertDialog idiom as the settings-reset warning.
                  Async-button rule: disabled in place while pending, label never
                  changes — outcome feedback is the toast the mutation raises. */}
              <AlertDialog>
                <AlertDialogTrigger render={<Button disabled={!complete || submit.isPending} />}>
                  Submit picks
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {`Submit ${required} ${required === 1 ? "pick" : "picks"} for ${slate.label}?`}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {pickType === PICK_TYPE.AGAINST_THE_SPREAD
                        ? "These picks are final for the week, at the spreads shown. Once they're in they can't be changed, replaced, or removed."
                        : "These picks are final for the week. Once they're in they can't be changed, replaced, or removed."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={submit.isPending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction disabled={submit.isPending} onClick={handleSubmit}>
                      Submit picks
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
