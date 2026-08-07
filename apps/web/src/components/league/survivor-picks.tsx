import { useState } from "react";
import type { SlateGame, SlateTeam, SurvivorPick, WeekSlateResponse } from "@picksleagues/schemas";
import { useSubmitSurvivorPick, useSurvivorWeekPicks } from "@/api/survivor";
import { useWeekSlate } from "@/api/weeks";
import { isClosedToPicks } from "@/lib/game";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryState } from "@/components/query-state";
import { SurvivorGameRow } from "@/components/league/survivor-game-row";

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
  // The endpoint refuses a non-member outright, so the viewer is always among
  // the members it returns; the guard narrows the type rather than covering a
  // state the screen can reach.
  const viewer = picks.data?.members.find((member) => member.isViewer);

  return (
    <QueryState
      isPending={slate.isPending || picks.isPending}
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
        (viewer.eliminated ? (
          <EliminatedWeek slate={slate.data} pick={viewer.pick} />
        ) : (
          <SurvivorPickSheet
            // Remounted per week so a selection made while looking at another
            // week can never bleed into this one.
            key={weekId}
            leagueId={leagueId}
            weekId={weekId}
            slate={slate.data}
            saved={selectionOf(viewer.pick)}
            consumedTeamIds={picks.data.consumedTeamIds}
          />
        ))}
    </QueryState>
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
  const team = pick ? (teamsById(slate.games).get(pick.teamId) ?? null) : null;

  return (
    <Card data-testid="survivor-eliminated">
      <CardHeader>
        <CardTitle>You&apos;re out</CardTitle>
        <CardDescription>
          One of your picks lost, so you&apos;re eliminated for the season and can&apos;t pick any
          more weeks. You can still follow the league.
        </CardDescription>
      </CardHeader>
      {team && (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {`Your pick for ${slate.label}: ${team.name}.`}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * The live week: every game, both teams, and one Save.
 *
 * Closed games stay on screen rather than being filtered out the way Pick'em's
 * sheet filters them — with only one pick to place, a member scanning for a
 * team needs to see that the game it was in has already gone, not find it
 * missing.
 */
function SurvivorPickSheet({
  leagueId,
  weekId,
  slate,
  saved,
  consumedTeamIds,
}: {
  leagueId: string;
  weekId: string;
  slate: WeekSlateResponse;
  saved: SurvivorSelection | null;
  consumedTeamIds: string[];
}) {
  const submit = useSubmitSurvivorPick(leagueId, weekId);
  const [selection, setSelection] = useState<SurvivorSelection | null>(null);

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
            {frozen
              ? "Your pick has kicked off, so this week is set. Come back next week."
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
            {slate.games.map((game) => (
              <SurvivorGameRow
                key={game.id}
                game={game}
                heldTeamId={held?.gameId === game.id ? held.teamId : null}
                consumedTeamIds={consumed}
                frozen={frozen}
                onSelect={(teamId) => setSelection({ gameId: game.id, teamId })}
              />
            ))}
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
            <p data-testid="survivor-pick-status" className="text-sm text-muted-foreground">
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
