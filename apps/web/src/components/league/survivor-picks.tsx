import { useState } from "react";
import type { SlateGame, SlateTeam, SurvivorPick, WeekSlateResponse } from "@picksleagues/schemas";
import { useSubmitSurvivorPick, useSurvivorStandings, useSurvivorWeekPicks } from "@/api/survivor";
import { useWeekSlate } from "@/api/weeks";
import { isClosedToPicks } from "@/lib/game";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryState } from "@/components/query-state";
import { SurvivorGameRow, SurvivorPickedGameRow } from "@/components/league/survivor-game-row";

/** A team taken out of a specific game — the shape both the sheet and the write path speak. */
export type SurvivorSelection = { gameId: string; teamId: string };

/**
 * Which pick the sheet is actually holding: the member's own selection while
 * its game can still take it, otherwise whatever the server has on record.
 *
 * Re-resolved on **every** render, not only when a selection is made. Games
 * kick off one at a time through a Sunday and a background slate refetch brings
 * that in without remounting the sheet, so a selection made while a game was
 * open outlives the game's own pickability. Continuing to show it would offer a
 * Save the write path can only refuse with `pick_locked`, while hiding the pick
 * the member genuinely has on record.
 */
export function heldSurvivorSelection(
  games: Pick<SlateGame, "id" | "locked" | "pickable">[],
  selection: SurvivorSelection | null,
  saved: SurvivorSelection | null,
): SurvivorSelection | null {
  if (!selection) return saved;
  const game = games.find((candidate) => candidate.id === selection.gameId);
  if (!game || isClosedToPicks(game)) return saved;
  return selection;
}

function teamsById(games: SlateGame[]): Map<string, SlateTeam> {
  const teams = new Map<string, SlateTeam>();
  for (const game of games) {
    teams.set(game.homeTeam.id, game.homeTeam);
    teams.set(game.awayTeam.id, game.awayTeam);
  }
  return teams;
}

function selectionOf(pick: SurvivorPick | null): SurvivorSelection | null {
  return pick ? { gameId: pick.gameId, teamId: pick.teamId } : null;
}

function SurvivorPicksSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading this week's games"
      className="flex flex-col gap-3 rounded-xl border border-border p-4"
    >
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: 4 }, (_unused, index) => (
        <Skeleton key={index} className="h-28 w-full" />
      ))}
    </div>
  );
}

/**
 * The member's own Survivor week: one team, changeable until that team's game
 * kicks off (spec §Game Mode 2).
 *
 * Deliberately not Pick'em's shape. There is no irreversible submission and no
 * terminal "submitted" view here — ADR-0018's one-shot semantic is Pick'em's
 * alone — so this screen is a single sheet whose Save replaces, plus the one
 * state a member can't pick from at all: eliminated.
 */
export function SurvivorPicks({ leagueId, weekId }: { leagueId: string; weekId: string }) {
  const slate = useWeekSlate(weekId);
  const picks = useSurvivorWeekPicks(leagueId, weekId);
  // The board, for the one thing the week's own response has no field for:
  // whether the season is already decided. A decided season refuses every write
  // with `league_concluded` (ADR-0027) while its later weeks stay in the
  // league's range, so without this the members who *won* get a full sheet and
  // a Save the API can only refuse. `concluded` is already on the wire, which
  // is why this reads the board rather than growing a field here.
  const season = useSurvivorStandings(leagueId);
  // The endpoint refuses a non-member outright, so the viewer is always among
  // the members it returns; the guard narrows the type rather than covering a
  // state the screen can reach.
  const viewer = picks.data?.members.find((member) => member.isViewer);
  const concluded = season.data?.concluded === true;
  // Asked of the board's winner set rather than of "concluded and still alive",
  // matching the precedence `pick-status.ts` resolves the dashboard glance in so
  // the sheet and the glance cannot disagree about who won.
  const won =
    concluded && season.data?.members.find((member) => member.isViewer)?.isWinner === true;

  return (
    <QueryState
      // The board sits in the pending gate but deliberately not the error one:
      // waiting for it keeps a sheet from rendering a beat before it turns into
      // a season-over card, while a board that failed to load must never cost a
      // member a pick they can still make.
      isPending={slate.isPending || picks.isPending || season.isPending}
      pendingFallback={<SurvivorPicksSkeleton />}
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
        viewer &&
        (won || (concluded && !viewer.eliminated) ? (
          <SeasonOverWeek slate={slate.data} pick={viewer.pick} won={won} />
        ) : viewer.eliminated ? (
          <EliminatedWeek slate={slate.data} pick={viewer.pick} />
        ) : (
          <SurvivorPickSheet
            // Remounted per week so a selection made while looking at another
            // week can never bleed into this one.
            key={weekId}
            leagueId={leagueId}
            weekId={weekId}
            slate={slate.data}
            pick={viewer.pick}
            consumedTeamIds={picks.data.consumedTeamIds}
          />
        ))}
    </QueryState>
  );
}

/**
 * The member's own pick for a week they can no longer act on — shown as the one
 * game it is in, never as the whole slate. With nothing left to choose, the
 * other games are rows they can only scan past.
 */
function PickedGame({ slate, pick }: { slate: WeekSlateResponse; pick: SurvivorPick | null }) {
  const game = pick ? slate.games.find((candidate) => candidate.id === pick.gameId) : undefined;
  if (!pick || !game) return null;

  return (
    <CardContent>
      <ul className="flex flex-col gap-3">
        <SurvivorPickedGameRow game={game} teamId={pick.teamId} outcome={pick.outcome} />
      </ul>
    </CardContent>
  );
}

/**
 * The week as a member of a decided season sees it (spec §End of League,
 * ADR-0027): a result, not a sheet.
 *
 * A season ends when its range plays out *or* when settlement leaves one member
 * standing, and the weeks after that second ending are still in the league's
 * range — so a member can navigate to one and the week list will offer it. What
 * they must not get there is a sheet, because every Save on it is a refusal the
 * server has already decided.
 */
function SeasonOverWeek({
  slate,
  pick,
  won,
}: {
  slate: WeekSlateResponse;
  pick: SurvivorPick | null;
  won: boolean;
}) {
  return (
    <Card data-testid="survivor-season-over" data-won={won ? "true" : "false"}>
      <CardHeader>
        <CardTitle>{won ? "You made it" : "Season over"}</CardTitle>
        <CardDescription>
          {won
            ? "This season is decided and you're one of the members left standing, so there are no more picks to make."
            : "This league's season is over, so there are no more picks to make."}
        </CardDescription>
      </CardHeader>
      <PickedGame slate={slate} pick={pick} />
    </Card>
  );
}

/**
 * The week as an eliminated member sees it: an answer, not a sheet.
 *
 * A disabled sheet would be the wrong claim — it implies a pick that could be
 * made if something changed, and nothing will: elimination is for the season.
 * The week selector above this stays live, because an eliminated member keeps
 * full visibility of the league (spec §Game Mode 2 — Core Rules).
 */
function EliminatedWeek({ slate, pick }: { slate: WeekSlateResponse; pick: SurvivorPick | null }) {
  return (
    <Card data-testid="survivor-eliminated">
      <CardHeader>
        <CardTitle>You&apos;re out</CardTitle>
        {/* No cause is named, because this card cannot know it. A missed pick
            eliminates exactly as a losing one does (spec §Game Mode 2 — Core
            Rules), and the member's own elimination week isn't on this surface —
            so "one of your picks lost" was a false statement to anyone who
            simply never picked. The board names the week; this says what it
            means for them. */}
        <CardDescription>
          You&apos;re eliminated for the season, so there are no more picks to make. You can still
          follow the league.
        </CardDescription>
      </CardHeader>
      <PickedGame slate={slate} pick={pick} />
    </Card>
  );
}

/**
 * The live week: the games still open to a pick, both teams, and one Save.
 *
 * A game that has kicked off is dropped unless it is the member's own, matching
 * how Pick'em's sheet filters its week — a row offering two teams neither of
 * which can be taken is an offer that isn't there, and at phone width it pushes
 * the ones that can be taken off screen. **The member's own game is the
 * exception and stays whatever its state**, because a pick on a cancelled game
 * is still live (it grades as a push) and dropping it would hide the one row
 * carrying the "not graded yet" explanation for why the team hasn't come back.
 */
function SurvivorPickSheet({
  leagueId,
  weekId,
  slate,
  pick,
  consumedTeamIds,
}: {
  leagueId: string;
  weekId: string;
  slate: WeekSlateResponse;
  pick: SurvivorPick | null;
  consumedTeamIds: string[];
}) {
  const submit = useSubmitSurvivorPick(leagueId, weekId);
  const [selection, setSelection] = useState<SurvivorSelection | null>(null);

  const saved = selectionOf(pick);
  const held = heldSurvivorSelection(slate.games, selection, saved);
  const changed = held !== null && (held.gameId !== saved?.gameId || held.teamId !== saved?.teamId);
  const consumed = new Set(consumedTeamIds);
  const teams = teamsById(slate.games);
  const heldTeam = held ? (teams.get(held.teamId) ?? null) : null;

  // The pick on record freezes at *its own* game's kickoff, which is the write
  // path's rule — so a member whose Thursday team has kicked off is done for the
  // week even though Sunday's games are still open, and offering them a Save the
  // API would refuse with `pick_locked` is worse than saying so.
  const savedGame = saved ? slate.games.find((game) => game.id === saved.gameId) : undefined;
  const frozen = savedGame?.locked === true;
  const openGames = slate.games.filter((game) => !isClosedToPicks(game));
  const canPick = !frozen && openGames.length > 0;
  // Their own game is kept by id rather than by state: a pick whose game was
  // cancelled is closed to picks but still the member's live pick for the week.
  const visibleGames = slate.games.filter(
    (game) => !isClosedToPicks(game) || game.id === saved?.gameId,
  );

  function handleSave() {
    if (!held) return;
    submit.mutate({ gameId: held.gameId, teamId: held.teamId });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{slate.label}</CardTitle>
          <CardDescription>
            {/* No "come back next week": this sheet holds one week and cannot
                see whether another follows it, and on the final week of a
                league's resolved range there is none to come back for. */}
            {frozen
              ? "Your pick has kicked off, so this week is set."
              : openGames.length === 0
                ? "This week is closed — no games are still open to pick."
                : "Pick one team to win. You can change your pick until that team's game kicks off, and each team can only be used once all season."}
          </CardDescription>
        </CardHeader>
        {/* Bottom padding clears the fixed action bar below so it never covers
            the last row's controls when scrolled to the bottom — and is dropped
            with the bar, since the reserved gap reads as a broken layout with
            nothing in it. */}
        <CardContent className={cn("flex flex-col gap-4", canPick && "pb-24")}>
          {!frozen && openGames.length === 0 && !saved && (
            <p className="text-sm text-muted-foreground">You didn&apos;t make a pick this week.</p>
          )}
          <ul className="flex flex-col gap-3">
            {frozen && savedGame && pick ? (
              // Their own game alone. A slate of teams none of which can be
              // taken is an offer that isn't there: the write path refuses every
              // change out of a pick whose game has kicked off, so what is left
              // to say about this week is how the one pick they hold is doing.
              <SurvivorPickedGameRow game={savedGame} teamId={pick.teamId} outcome={pick.outcome} />
            ) : (
              visibleGames.map((game) => (
                <SurvivorGameRow
                  key={game.id}
                  game={game}
                  heldTeamId={held?.gameId === game.id ? held.teamId : null}
                  consumedTeamIds={consumed}
                  onSelect={(teamId) => setSelection({ gameId: game.id, teamId })}
                />
              ))
            )}
          </ul>
        </CardContent>
      </Card>

      {/* Fixed rather than CSS-sticky, and z-20, for the reasons
          pickem-picks.tsx's bar states: Card's `overflow-hidden` breaks a sticky
          descendant, and the app's layering puts the tab bar (30) and header
          (40) above this. */}
      {canPick && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            {/* Named for what it reports — whether the sheet holds unsaved
                changes — not "pick status", which is the dashboard glance's
                claim about the week (ELM-6) and carries a machine value this
                line has no equivalent of. */}
            <p data-testid="survivor-pick-save-state" className="text-sm text-muted-foreground">
              {heldTeam
                ? changed
                  ? `${heldTeam.name} selected — not saved yet`
                  : `Your pick: ${heldTeam.name}`
                : "No pick yet this week"}
            </p>
            {/* Disabled in place while the write is in flight, and the label
                never changes — outcome feedback is the toast the mutation
                raises. Nothing else on the sheet is disabled by it: the member
                may keep choosing while it lands. */}
            <Button
              className="shrink-0"
              disabled={!changed || submit.isPending}
              onClick={handleSave}
            >
              Save pick
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
