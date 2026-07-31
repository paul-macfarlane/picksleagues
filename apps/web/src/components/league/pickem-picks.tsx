import { useState } from "react";
import {
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  type PickemPickSide,
  type PickType,
  type PickemPick,
  type PickemPickSubmission,
  type SlateGame,
  type WeekSlateResponse,
} from "@picksleagues/schemas";
import { useSubmitPicks, useWeekPicks } from "@/api/pickem";
import { useWeekSlate } from "@/api/weeks";
import { isClosedToPicks, spreadLabel } from "@/lib/game";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/query-state";
import { StatusPill } from "@/components/status-pill";
import { TeamLogo } from "@/components/team-logo";
import { GameRow } from "@/components/league/pickem-game-row";
import { PickemSubstituteDialog } from "@/components/league/pickem-substitute-dialog";

/**
 * Narrows a selection map to the games this editor may still submit
 * (spec/ADR-0015: unlocked and pickable) — a locked, cancelled/moved, or
 * week-moved pick is retained server-side and must never be re-submitted.
 *
 * Applied on **every** render, not only when seeding at mount. Games lock one
 * at a time through a Sunday and a background slate refetch brings that in
 * without remounting the editor, so a selection made while a game was open
 * outlives the game's own editability. Leaving it in place counted the pick in
 * both this map and the retained one ("8 of 5 picks") and would have submitted
 * it into the write path's lock guard on the next save.
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
 * Whether any side button on the screen can still be operated — the honest
 * condition for showing the save bar, since the bar exists to save changes and
 * a change needs a control the member can actually press.
 *
 * Mirrors a row's own two gates exactly: the game must still be open, and
 * adding a *new* pick is refused at the cap (`buttonsDisabled` below). So a
 * held pick on an open game always stays operable — it can be given up, which
 * is what frees a slot — while an unpicked open game is dead weight once the
 * cap is reached.
 *
 * "Is any game still open" is the near-miss this replaces (feedback round 4):
 * a member at their cap whose every pick has locked can act on nothing, yet a
 * week with later kickoffs still has open games, so the bar stayed pinned with
 * a Save that could never enable.
 */
export function hasOperableControl(
  games: Pick<SlateGame, "id" | "locked" | "pickable">[],
  selections: Map<string, PickemPickSide>,
  atCap: boolean,
): boolean {
  return games.some((game) => !isClosedToPicks(game) && (selections.has(game.id) || !atCap));
}

/**
 * The games worth putting on a member's *own* pick screen: ones they hold a
 * pick on, plus — while anything on the page can still be operated — every game
 * still open. A game that kicked off without their pick is gone, so the week in
 * review is their picks rather than a slate they must scan past.
 *
 * `canEditPicks` (i.e. `hasOperableControl`) rather than "is this game open" is
 * what makes the second clause correct in both directions, and neither half is
 * obvious:
 *
 * - **The cap alone must not hide a game.** At the cap with *unlocked* picks a
 *   member can still switch into an unpicked game — ADR-0015 replaces the whole
 *   week, so changing your mind usually means picking a *different* game — and
 *   hiding the target would trap them. This is the objection that defeated the
 *   two earlier "show only my picks" proposals; gating on the week's operability
 *   rather than the game's answers it.
 * - **Openness alone must not show one.** At the cap with every pick locked,
 *   there is no slot to free, so an unstarted game is unreachable however open
 *   it looks. Those are the dead rows this is meant to remove.
 *
 * Sharing the predicate with the save bar is the point: unpicked open games
 * exist to be changed into, so they live and die with the control that saves
 * changes. The screen becomes the week in review in the same render the bar
 * retires in.
 */
export function visibleGames<T extends { id: string; locked: boolean; pickable: boolean }>(
  games: readonly T[],
  heldGameIds: ReadonlySet<string>,
  canEditPicks: boolean,
): T[] {
  return games.filter(
    (game) => heldGameIds.has(game.id) || (!isClosedToPicks(game) && canEditPicks),
  );
}

/**
 * How many of the member's already-committed picks a save would re-price.
 *
 * ATS submissions are all-or-nothing by rule: the payload carries *every*
 * selected game at its current line, so changing one pick accepts the latest
 * spread on all the others too (spec §ATS spread acceptance, ADR-0015 —
 * "spreads cannot be selectively frozen"). Lines move through the week, so a
 * member who picked on Tuesday and edits on Saturday is the ordinary case, not
 * an edge one, and the count is what makes the consequence legible before they
 * commit rather than after.
 *
 * Counts only *committed* picks whose stored number differs from the live one.
 * A brand-new selection isn't being re-priced — it has no prior price — and an
 * unchanged line isn't either, even though it is resubmitted.
 */
export function repricedPickCount(
  games: readonly Pick<SlateGame, "id" | "spread">[],
  selections: ReadonlyMap<string, PickemPickSide>,
  committedSpreadByGameId: ReadonlyMap<string, number | null>,
): number {
  let count = 0;
  for (const game of games) {
    if (!selections.has(game.id)) continue;
    if (!committedSpreadByGameId.has(game.id)) continue;
    if (committedSpreadByGameId.get(game.id) !== game.spread) count += 1;
  }
  return count;
}

/**
 * Whether this week's screen has nothing at all to render.
 *
 * Deliberately not "is the slate empty". A pick whose game moved to another
 * week is retained (ADR-0015) and is *by definition* absent from this week's
 * slate — so a week can hold zero games and still owe the member the pushed
 * pick they carry, its explanation, and its substitute control. Gating the
 * editor on the slate alone hid exactly that, behind a "no games synced"
 * message that additionally blamed ingestion for something the provider did on
 * purpose.
 */
export function weekHasNothingToShow(slateGameCount: number, viewerPickCount: number): boolean {
  return slateGameCount === 0 && viewerPickCount === 0;
}

/**
 * The team a moved-out pick was on, rendered the same way a slate row renders
 * one — logo, abbreviation, and the spread of record in an ATS league. Falls
 * back to nothing renderable only if the API sent no `movedGame`, which it does
 * for exactly the picks that are still in the slate (and so never reach here).
 */
function MovedPickTeam({ pick, pickType }: { pick: PickemPick; pickType: PickType }) {
  if (!pick.movedGame) return <>Pick moved out of this week</>;

  const picked =
    pick.side === PICKEM_PICK_SIDE.HOME ? pick.movedGame.homeTeam : pick.movedGame.awayTeam;
  const spread =
    pickType === PICK_TYPE.AGAINST_THE_SPREAD ? spreadLabel(pick.spread, pick.side) : null;

  return (
    <>
      <TeamLogo logoLightUrl={picked.logoLightUrl} logoDarkUrl={picked.logoDarkUrl} size="sm" />
      {picked.abbreviation}
      {spread && ` ${spread}`}
    </>
  );
}

function hydrateSelections(slate: WeekSlateResponse, viewerPicks: PickemPick[]) {
  return openSelections(slate.games, new Map(viewerPicks.map((pick) => [pick.gameId, pick.side])));
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
  const viewerPicks = picks.data?.members.find((member) => member.isViewer)?.picks ?? [];

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
      isEmpty={weekHasNothingToShow(slate.data?.games.length ?? 0, viewerPicks.length)}
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
          viewerPicks={viewerPicks}
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
  const [storedSeed, setStoredSeed] = useState(() => hydrateSelections(slate, viewerPicks));
  const [storedSelections, setStoredSelections] = useState<Map<string, PickemPickSide>>(
    () => new Map(storedSeed),
  );
  /**
   * The member has explicitly taken the latest spreads on their unstarted picks.
   *
   * An explicit act rather than an implied one, because the alternative is
   * worse in both directions: leaving the live number on a *highlighted* button
   * reads as "you picked this" no matter what copy sits beside it, and without
   * an accept control the only way to take a moved line was to toggle a pick
   * off and back on to make the form dirty — a workaround the member has to
   * invent.
   *
   * Week-scoped, not per row, because that is the rule's own scope: accepting
   * re-prices every unstarted pick (spec §ATS spread acceptance). A per-row
   * control would state the opposite of what it does.
   */
  const [spreadsAccepted, setSpreadsAccepted] = useState(false);

  // Both maps are re-narrowed against the *current* slate on every render
  // rather than trusted to have stayed valid since mount — see openSelections.
  // Filtering both keeps the dirty check honest: a game locking under the
  // member drops the same entry from each side, so it can't read as an edit
  // they didn't make.
  const seed = openSelections(slate.games, storedSeed);
  const selections = openSelections(slate.games, storedSelections);

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
    if (!game || isClosedToPicks(game)) {
      retainedPickByGameId.set(pick.gameId, { pick, pushed });
    }
  }

  // Exactly complementary to the retained map by construction — both sides key
  // off `isClosedToPicks`, so no pick can land in both (the miscount) or
  // neither (an undercount).
  const heldCount = retainedPickByGameId.size + selections.size;
  const atCap = heldCount >= picksAllowed;
  // Accepting moved spreads is itself a change worth saving even when no
  // selection moved — it is the whole point of the control, and without it the
  // member would have to fake a change to submit at the new numbers.
  const selectionsChanged = !selectionsEqual(seed, selections);

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
    (game) => !isClosedToPicks(game) && !heldGameIds.has(game.id),
  );

  // Every committed pick by game, retained or not — the row needs the number
  // the member actually holds, which `retainedPickByGameId` only carries for
  // picks that have stopped being editable.
  const committedPickByGameId = new Map(viewerPicks.map((pick) => [pick.gameId, pick]));
  const committedSpreadByGameId = new Map(
    viewerPicks.map((pick) => [pick.gameId, pick.spread] as const),
  );
  const repriced =
    pickType === PICK_TYPE.AGAINST_THE_SPREAD
      ? repricedPickCount(slate.games, selections, committedSpreadByGameId)
      : 0;
  const dirty = selectionsChanged || (spreadsAccepted && repriced > 0);

  const anyOpenGames = slate.games.some((game) => !isClosedToPicks(game));
  const canEditPicks = hasOperableControl(slate.games, selections, atCap);
  const shownGames = visibleGames(slate.games, heldGameIds, canEditPicks);

  // Pushed picks whose game moved to a different week entirely aren't in this
  // slate at all (ADR-0015), so they never render via the games list below —
  // they get their own row here instead.
  const pushedOutOfWeekPicks = [...retainedPickByGameId.entries()]
    .filter(([gameId, retained]) => retained.pushed && !gameById.has(gameId))
    .map(([, retained]) => retained.pick);

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

  // A substitution writes a new pick server-side without going through this
  // editor's own save — sync both maps so the replacement shows as held
  // immediately (heldCount, the "N / M picked" count, and the game's row)
  // rather than waiting on a remount. Written into `seed` too so the editor
  // doesn't read as dirty for a pick the member didn't touch.
  function handleSubstituted(gameId: string, side: PickemPickSide) {
    setStoredSelections((prev) => new Map(prev).set(gameId, side));
    setStoredSeed((prev) => new Map(prev).set(gameId, side));
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
          // Every submitted pick carries the spread currently shown for that
          // game — the write path re-prices every unstarted pick on every
          // edit (ADR-0015); SU leagues send null (spec §Pick Type).
          spread: pickType === PICK_TYPE.AGAINST_THE_SPREAD ? game.spread : null,
        },
      ];
    });
    submit.mutate(payload, {
      onSuccess: (data) => {
        if (!data) return;
        setStoredSeed(new Map(storedSelections));
        // The refetched picks come back carrying the numbers just accepted, so
        // `repriced` returns to 0 on its own — clearing the flag keeps the two
        // from disagreeing for the render in between.
        setSpreadsAccepted(false);
      },
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{slate.label}</CardTitle>
          {/* Progress normally lives in the action bar, which is always on
              screen — repeating the count here in a second phrasing would only
              give it somewhere to drift. Once the bar retires it has nowhere
              else to go, so the same formatter renders it here instead. */}
          {/* The two reasons the bar can be gone read differently to a member
              and are worth separating: the week itself is over, or later games
              remain but they are out of picks and every one they made has
              locked. Exhaustive by construction — an open game is always
              operable below the cap, so the bar only ever retires in these
              two states. */}
          <CardDescription>
            {canEditPicks
              ? "Each pick locks at its own kickoff."
              : slate.games.length === 0
                ? // Reachable only when every game left the week and the member is
                  // holding picks on them — otherwise the screen is the empty
                  // state above. The progress phrasing is actively wrong here:
                  // `picksAllowed` counts *available* games, so a member holding
                  // one pick reads "1 of 0 picks", and "this week is locked" names
                  // the wrong reason. The rows below carry the real explanation.
                  "No games remain in this week."
                : `${pickProgressLabel(heldCount, picksAllowed)} · ${
                    anyOpenGames ? "every pick you made is locked." : "this week is locked."
                  }`}
          </CardDescription>
        </CardHeader>
        {/* Bottom padding clears the fixed action bar below so it never
            covers the last game row's controls when scrolled to the bottom
            (verified at 375px) — and is dropped with the bar, since the
            reserved gap reads as a broken layout with nothing in it. */}
        <CardContent className={cn("flex flex-col gap-4", canEditPicks && "pb-24")}>
          {pushedOutOfWeekPicks.length > 0 && (
            <ul className="flex flex-col gap-3">
              {pushedOutOfWeekPicks.map((pick) => (
                <li
                  key={pick.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* Name the pick, not just its fate. Without the matchup a
                        member holding several picks can't tell which one this
                        row is about — the game is absent from the slate, so
                        the API carries the teams on the pick itself. */}
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                      <MovedPickTeam pick={pick} pickType={pickType} />
                    </p>
                    <StatusPill>Push</StatusPill>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {pick.movedGame
                      ? `${pick.movedGame.awayTeam.abbreviation} @ ${pick.movedGame.homeTeam.abbreviation} moved to ${pick.movedGame.weekLabel}, so this pick resolved as a push.`
                      : "That game moved to a different week, so this pick resolved as a push."}
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

          {/* Reachable only once the week has closed around a member who
              picked nothing: every other state either shows their picks or
              still has an open game to offer. Without it the card renders as an
              empty box, which reads as a load failure rather than an answer. */}
          {shownGames.length === 0 && pushedOutOfWeekPicks.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You didn&apos;t make any picks this week.
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {shownGames.map((game) => {
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
                  committedPick={committedPickByGameId.get(game.id)}
                  spreadsAccepted={spreadsAccepted}
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
          require scrolling to the bottom to find the button). Mounted only
          while a control on this page can still be operated — see
          hasOperableControl. `fixed`, not
          CSS `sticky` — Card sets `overflow-hidden` for its rounded corners,
          and any ancestor with overflow other than visible clips/breaks a
          sticky descendant, whereas `fixed` escapes ancestor layout
          entirely and anchors straight to the viewport, which is exactly
          what we want since the document is the app's only scroll container
          (no ancestor here sets a transform/filter that would trap it).
          z-20 stays under the tab bar (z-30) and header (z-40) per
          routes/_authed.tsx's layering comment, and well under overlay
          portals (z-50). */}
      {canEditPicks && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
          {/* Stacks at phone width: the accept control makes this row two
              buttons wide, which crowds the count beside it at 375px. Above
              `sm` there is room for the original single line. */}
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex flex-col">
              <p className="text-sm text-muted-foreground">
                {pickProgressLabel(heldCount, picksAllowed)}
                {dirty && <span className="text-foreground"> · unsaved</span>}
              </p>
              {/* Stated before the save, not after: the all-or-nothing rule
                  means editing one game moves the number on every other
                  unstarted pick too, which is invisible from the row being
                  edited. Muted and factual rather than a warning — lines drift
                  all week, so this is the normal case and reads as information,
                  not a problem.

                  The two phrasings are the same fact at different moments:
                  before accepting it is an offer with its scope named, after it
                  is what the pending save will do. */}
              {repriced > 0 && (
                <p className="text-xs text-muted-foreground">
                  {spreadsAccepted || selectionsChanged
                    ? `Saving updates ${repriced} ${repriced === 1 ? "pick" : "picks"} to the latest spreads.`
                    : `${repriced} ${repriced === 1 ? "pick is" : "picks are"} at spreads that have moved.`}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              {/* Week-scoped by design — see `spreadsAccepted`. Hidden once
                  accepted (or once an edit has already committed the member to
                  re-pricing), because at that point the bar's own line already
                  says what the save will do and a second control would imply
                  there is more to opt into. */}
              {repriced > 0 && !spreadsAccepted && !selectionsChanged && (
                <Button
                  variant="outline"
                  disabled={submit.isPending}
                  onClick={() => setSpreadsAccepted(true)}
                >
                  Accept latest spreads
                </Button>
              )}
              {/* Async-button rule: disabled in place while pending, label never
                  changes — outcome feedback is the toast the mutation already
                  raises on success/error. */}
              <Button disabled={submit.isPending || !dirty} onClick={handleSubmit}>
                Save picks
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
