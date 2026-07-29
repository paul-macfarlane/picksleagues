import {
  GAME_STATUS,
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  type PickemPick,
  type PickemPickSide,
  type PickOutcome,
  type PickType,
  type SlateGame,
} from "@picksleagues/schemas";
import { pickMargin } from "@picksleagues/scoring";
import {
  gameStateAsOfLabel,
  gameStateLabel,
  isClosedToPicks,
  pickMarginLabel,
  pickRowState,
  spreadLabel,
} from "@/lib/game";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PickemSubstituteDialog } from "@/components/league/pickem-substitute-dialog";
import { GameStatePill } from "@/components/league/game-state";
import {
  PickOutcomeBadge,
  PickOutcomeIcon,
  pickOutcomeButtonClassName,
} from "@/components/league/pick-outcome";
import { StatusPill } from "@/components/status-pill";
import { TeamLogo } from "@/components/team-logo";

/**
 * A single game's row in the pick editor: the matchup, its state, the two side
 * controls, and whatever the row is allowed to say about the pick held on it.
 * Split out of `pickem-picks.tsx` — which owns the week's selection state,
 * cap arithmetic, and save — because a row's rendering is its own
 * responsibility and grew past the file's line budget once outcomes landed.
 */

/**
 * One side of a matchup as a pick control. `held` — not "selected" — because
 * it covers a locked or settled pick just as much as a live selection: the
 * fill and `aria-pressed` are the row's answer to "who did I take", and that
 * question outlives the ability to change the answer.
 *
 * A held side carries a glyph only once it has graded, and then it is the
 * *outcome's* glyph. An unsettled pick gets the fill alone: a checkmark on one
 * reads as "you got this right" rather than "you chose this", and on a game
 * that hasn't finished there is no such fact — the app would be claiming an
 * outcome it doesn't have. The fill, the row border, and the badge carry
 * "chosen" between them until a result exists.
 */
function SideButton({
  team,
  spread,
  held,
  outcome,
  disabled,
  onClick,
}: {
  team: SlateGame["homeTeam"];
  spread: string | null;
  held: boolean;
  outcome: PickOutcome | null;
  disabled: boolean;
  onClick: () => void;
}) {
  const settled = held && outcome !== null;
  return (
    <Button
      type="button"
      // A settled side reads through its outcome colour, which needs the
      // outline shape to show against — the filled `default` would bury it.
      variant={held && !settled ? "default" : "outline"}
      aria-pressed={held}
      className={cn(
        // A held side spends most of its life disabled — every row is locked
        // once its game kicks off — so it lifts out of the standard disabled
        // dimming enough to stay readable against its outline sibling.
        held && "disabled:opacity-75",
        settled && pickOutcomeButtonClassName(outcome),
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {settled && <PickOutcomeIcon outcome={outcome} />}
      <TeamLogo logoLightUrl={team.logoLightUrl} logoDarkUrl={team.logoDarkUrl} size="sm" />
      {team.abbreviation}
      {spread && ` ${spread}`}
    </Button>
  );
}

export function GameRow({
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
  selectedSide: PickemPickSide | undefined;
  retained: { pick: PickemPick; pushed: boolean } | undefined;
  eligibleReplacementGames: SlateGame[];
  buttonsDisabled: boolean;
  onToggle: (side: PickemPickSide) => void;
  onSubstituted: (gameId: string, side: PickemPickSide) => void;
}) {
  const showSpread = pickType === PICK_TYPE.AGAINST_THE_SPREAD;
  // ATS leagues can't submit a pick with no number to accept — the write path
  // 409s (`spread_stale`, "no current number means there is nothing to
  // accept") for every attempt until the odds sync lands, so this is guarded
  // client-side rather than left to surface as a confusing repeat failure.
  const noLineYet = showSpread && game.spread === null;
  const editable = !isClosedToPicks(game) && !noLineYet;
  // Read once for the badge precedence below; `GameStatePill` re-checks it, so
  // the two can't disagree about which status counts as live.
  const inProgress = game.status === GAME_STATUS.IN_PROGRESS;
  const awaySpread = showSpread ? spreadLabel(game.spread, "away") : null;
  const homeSpread = showSpread ? spreadLabel(game.spread, "home") : null;
  // The side the member holds, however they came to hold it: toggled in this
  // editor, or committed earlier and now unchangeable (locked, or on a
  // cancelled/moved game — `hydrateSelections` deliberately keeps those out of
  // `selectedSide` so they can never be re-submitted). Everything *displayed*
  // reads this; only `selectedSide` decides what the save payload contains.
  // Splitting the two is the point: a locked row otherwise renders both sides
  // identically, which is precisely when the member most wants to see which
  // one they're stuck with.
  const heldSide = selectedSide ?? retained?.pick.side;
  // Only ever on a retained pick — an editable one, by definition, is on a game
  // that hasn't started, so it can have no result (arch D10).
  const outcome = retained?.pick.outcome ?? null;
  // Locked/unplayable still outrank a held pick for the row highlight — those
  // say "you can't act here", which is the more useful thing to see while
  // scanning; the buttons below carry the who-did-I-pick answer in every state.
  const rowState = pickRowState(game, heldSide !== undefined);
  const stateAsOf = gameStateAsOfLabel(game);
  // Only while the game is running: before kickoff there is nothing to read, and
  // once it settles the real grade takes over (see pickMarginLabel). Read off
  // the *pick's* accepted spread, never the game's current one, so it matches
  // what settlement will grade.
  const standing =
    inProgress && retained && game.awayScore !== null && game.homeScore !== null
      ? pickMargin(
          { side: retained.pick.side, spreadAtPick: retained.pick.spread },
          game.homeScore,
          game.awayScore,
          pickType,
        )
      : null;

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border p-3",
        // Full-strength `primary`, not a fraction of it: the palette is
        // achromatic, so a tinted border is the only row-level cue available
        // and a 50% one sits too close to `border` (white/10% in dark) to
        // survive scanning a 16-game slate.
        rowState === "picked" && "border-primary bg-primary/5",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        {/* One badge, most-informative-wins, and the chain is total because
            each state strictly implies the next: a settled pick takes the slot
            from "Locked" (every settled pick is locked, so the lock is implied
            and the grade is worth more), and an in-progress game takes it from
            "Locked" too — it has kicked off by definition, and "still being
            played" is the fact that separates it from the finished games above
            it and the unstarted ones below (feedback round 4). "In progress"
            and "Picked" can never contend: a picked row is unlocked, and an
            in-progress one cannot be. No status badge for unplayable games —
            the state line below carries the status for every non-scheduled
            game, and repeating "Cancelled" twelve pixels apart reads as a
            rendering bug. */}
        {outcome ? (
          <PickOutcomeBadge outcome={outcome} />
        ) : inProgress ? (
          <GameStatePill status={game.status} />
        ) : rowState === "picked" ? (
          <StatusPill tone="accent">Picked</StatusPill>
        ) : (
          game.locked && <StatusPill>Locked</StatusPill>
        )}
        {game.pickable && !game.locked && noLineYet && <StatusPill>No line yet</StatusPill>}
      </div>

      {/* Kickoff before the game starts, status + score after — a member whose
          pick has locked wants to know how it is doing, not when it began. */}
      <p className="text-xs text-muted-foreground">{gameStateLabel(game)}</p>
      {/* Own line, not appended to the state line above: this row has the
          room, and the qualifier reads more clearly set apart from the score
          it's dating than crowded onto the same line (DATA-8; spec §UI
          conventions — a stored clock reading can be minutes stale). */}
      {stateAsOf && <p className="text-xs text-muted-foreground/70">{stateAsOf}</p>}

      <div className="grid grid-cols-2 gap-2">
        <SideButton
          team={game.awayTeam}
          spread={awaySpread}
          held={heldSide === PICKEM_PICK_SIDE.AWAY}
          outcome={outcome}
          disabled={!editable || buttonsDisabled}
          onClick={() => onToggle(PICKEM_PICK_SIDE.AWAY)}
        />
        <SideButton
          team={game.homeTeam}
          spread={homeSpread}
          held={heldSide === PICKEM_PICK_SIDE.HOME}
          outcome={outcome}
          disabled={!editable || buttonsDisabled}
          onClick={() => onToggle(PICKEM_PICK_SIDE.HOME)}
        />
      </div>

      {!editable && (
        <div className="flex flex-col gap-2">
          {/* The standing rides on this line rather than the badge slot above
              because it is a fact about the *pick*, not the game — the badge
              there is already saying "In progress", which is the game's news. */}
          <p className="text-xs text-muted-foreground">
            {retained
              ? `Your pick: ${
                  retained.pick.side === PICKEM_PICK_SIDE.HOME
                    ? game.homeTeam.abbreviation
                    : game.awayTeam.abbreviation
                }`
              : "No pick"}
            {standing !== null && ` · ${pickMarginLabel(standing, pickType)}`}
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
              <PickemSubstituteDialog
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
