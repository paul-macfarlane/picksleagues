import { useState } from "react";
import {
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  type PickemPickSide,
  type PickType,
  type SlateGame,
} from "@picksleagues/schemas";
import { useRepick } from "@/api/pickem";
import { useAppNow } from "@/lib/app-clock";
import { formatKickoff } from "@/lib/format";
import { spreadLabel } from "@/lib/game";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { TeamLogo } from "@/components/team-logo";

// A radio value must be a single primitive; a game's side isn't addressable
// on its own (either side of any eligible game is a valid replacement), so
// the two are packed into one string. `:` is safe — gameId is a uuid.
function radioValue(gameId: string, side: PickemPickSide): string {
  return `${gameId}:${side}`;
}

function parseRadioValue(value: string): { gameId: string; side: PickemPickSide } {
  const separatorIndex = value.lastIndexOf(":");
  return {
    gameId: value.slice(0, separatorIndex),
    side: value.slice(separatorIndex + 1) as PickemPickSide,
  };
}

/**
 * The substitute half of §Cancellations: offered next to a pick whose game
 * pushed (cancelled, moved within the week, or moved out of it entirely —
 * ADR-0015). `eligibleGames` is precomputed by the caller (unstarted,
 * pickable, and not already held) so this component stays pure UI; an empty
 * list means the push simply stands, per spec, so no control is rendered.
 */
export function PickemSubstituteDialog({
  leagueId,
  weekId,
  pickType,
  replacePickId,
  eligibleGames,
  onSubstituted,
}: {
  leagueId: string;
  weekId: string;
  pickType: PickType;
  replacePickId: string;
  eligibleGames: SlateGame[];
  // The replacement's game/side, once the substitution actually lands — the
  // editor's own selection map is local state seeded once at mount (so a
  // background slate refetch can't clobber an in-progress edit) and won't
  // otherwise learn that this game is now held until the next full remount.
  onSubstituted: (gameId: string, side: PickemPickSide) => void;
}) {
  const repick = useRepick(leagueId, weekId);
  const now = useAppNow();
  const [choice, setChoice] = useState<string | null>(null);
  const showSpread = pickType === PICK_TYPE.AGAINST_THE_SPREAD;

  if (eligibleGames.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No unstarted games left to substitute — this push stands.
      </p>
    );
  }

  const selection = choice ? parseRadioValue(choice) : null;
  const selectedGame = selection
    ? eligibleGames.find((game) => game.id === selection.gameId)
    : undefined;

  function confirm() {
    if (!selection || !selectedGame) return;
    repick.mutate(
      {
        replacePickId,
        gameId: selection.gameId,
        side: selection.side,
        spread: showSpread ? selectedGame.spread : null,
      },
      {
        onSuccess: (data) => {
          if (data) onSubstituted(selection.gameId, selection.side);
        },
      },
    );
  }

  return (
    // Reset on close (both cancel and a successful confirm dismiss the
    // dialog) so reopening never shows a stale selection from last time.
    <AlertDialog onOpenChange={(open) => !open && setChoice(null)}>
      <AlertDialogTrigger
        render={<Button variant="outline" size="sm" disabled={repick.isPending} />}
      >
        Substitute
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Choose a replacement pick</AlertDialogTitle>
          <AlertDialogDescription>
            {/* The trade is the thing to say out loud: a member arriving here
                holds a push worth points, and substituting gives it up for a
                pick that scores nothing until its game finishes. Without this
                the standings appear to drop for no reason right after the
                substitution lands. */}
            You&apos;ll give up the push this pick is worth, and the replacement scores when its
            game finishes.{" "}
            {showSpread
              ? "You'll accept the current spread on this pick only — your other unstarted picks keep the spreads they were made at."
              : "Pick any of this week's remaining available games."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* `null`, never `undefined` — Base UI's RadioGroup treats a value
            transitioning to `undefined` as switching from controlled to
            uncontrolled (console warning); `null` is its "no selection" value. */}
        <RadioGroup value={choice} onValueChange={(value) => setChoice(value as string)}>
          {eligibleGames.map((game) => {
            const awaySpread = showSpread ? spreadLabel(game.spread, PICKEM_PICK_SIDE.AWAY) : null;
            const homeSpread = showSpread ? spreadLabel(game.spread, PICKEM_PICK_SIDE.HOME) : null;
            return (
              <div
                key={game.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <p
                  className="flex items-center gap-1.5 text-sm font-medium text-foreground"
                  title={`${game.awayTeam.name} @ ${game.homeTeam.name}`}
                >
                  <TeamLogo
                    logoLightUrl={game.awayTeam.logoLightUrl}
                    logoDarkUrl={game.awayTeam.logoDarkUrl}
                    size="sm"
                  />
                  {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
                  <TeamLogo
                    logoLightUrl={game.homeTeam.logoLightUrl}
                    logoDarkUrl={game.homeTeam.logoDarkUrl}
                    size="sm"
                  />
                </p>
                <p className="text-xs text-muted-foreground">
                  Kickoff {formatKickoff(game.kickoffAt, now)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Label className="flex items-center justify-between gap-2 rounded-md border border-border p-2 has-[[data-checked]]:border-primary">
                    <span className="flex items-center gap-1.5">
                      <TeamLogo
                        logoLightUrl={game.awayTeam.logoLightUrl}
                        logoDarkUrl={game.awayTeam.logoDarkUrl}
                        size="sm"
                      />
                      {game.awayTeam.abbreviation}
                      {awaySpread && ` ${awaySpread}`}
                    </span>
                    <RadioGroupItem value={radioValue(game.id, PICKEM_PICK_SIDE.AWAY)} />
                  </Label>
                  <Label className="flex items-center justify-between gap-2 rounded-md border border-border p-2 has-[[data-checked]]:border-primary">
                    <span className="flex items-center gap-1.5">
                      <TeamLogo
                        logoLightUrl={game.homeTeam.logoLightUrl}
                        logoDarkUrl={game.homeTeam.logoDarkUrl}
                        size="sm"
                      />
                      {game.homeTeam.abbreviation}
                      {homeSpread && ` ${homeSpread}`}
                    </span>
                    <RadioGroupItem value={radioValue(game.id, PICKEM_PICK_SIDE.HOME)} />
                  </Label>
                </div>
              </div>
            );
          })}
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={repick.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!choice || repick.isPending} onClick={confirm}>
            Confirm substitution
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
