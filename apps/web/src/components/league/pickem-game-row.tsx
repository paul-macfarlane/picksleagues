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
import {
  gameStateAsOfLabel,
  gameStateLabel,
  isClosedToPicks,
  pickRowState,
  pickStandingLabel,
  spreadLabel,
} from "@/lib/game";
import { useAppNow } from "@/lib/app-clock";
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

/**
 * Which side, if any, should show the spread its pick was *bought* at rather
 * than the live line — null when nothing on the row is held at an old price.
 *
 * Keyed on the **committed** side, never on whichever side is currently lit.
 * That distinction is the whole function: once the member switches teams, the
 * committed pick is being given up, and its replacement prices at the live line
 * like any new pick, so the old number stops being true about anything on the
 * row. Keying on the lit side instead put the *inverse of the old line* on the
 * newly-picked team (`-3.5` becoming `+3.5` on the other side) while handing the
 * abandoned team the live number — the two labels swapping places on one click.
 *
 * Deselecting entirely is the same story: nothing is held, so nothing shows a
 * stored price.
 *
 * A row that has stopped being editable keeps its stored number unconditionally.
 * There is no selection to compare against (`openSelections` drops closed games)
 * and the pick is frozen server-side, so neither a switch nor an acceptance can
 * reach it.
 */
export function storedPriceSideFor({
  committedSide,
  selectedSide,
  editable,
  spreadsAccepted,
}: {
  committedSide: PickemPickSide | undefined;
  selectedSide: PickemPickSide | undefined;
  editable: boolean;
  spreadsAccepted: boolean;
}): PickemPickSide | null {
  if (committedSide === undefined) return null;
  if (!editable) return committedSide;
  if (spreadsAccepted) return null;
  return selectedSide === committedSide ? committedSide : null;
}

export function GameRow({
  leagueId,
  weekId,
  game,
  pickType,
  selectedSide,
  retained,
  committedPick,
  spreadsAccepted,
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
  /**
   * The member's committed pick on this game, whatever state it is in — the
   * only place the spread they actually hold is available. `retained` carries
   * one too, but only once the pick has stopped being editable, which is
   * exactly the case where the number has *not* been at risk of moving.
   */
  committedPick: PickemPick | undefined;
  /** Week-level: the member has taken the latest spreads on every unstarted pick. */
  spreadsAccepted: boolean;
  eligibleReplacementGames: SlateGame[];
  buttonsDisabled: boolean;
  onToggle: (side: PickemPickSide) => void;
  onSubstituted: (gameId: string, side: PickemPickSide) => void;
}) {
  const now = useAppNow();
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
  // The side the member holds, however they came to hold it: toggled in this
  // editor, or committed earlier and now unchangeable (locked, or on a
  // cancelled/moved game — `hydrateSelections` deliberately keeps those out of
  // `selectedSide` so they can never be re-submitted). Everything *displayed*
  // reads this; only `selectedSide` decides what the save payload contains.
  // Splitting the two is the point: a locked row otherwise renders both sides
  // identically, which is precisely when the member most wants to see which
  // one they're stuck with.
  const heldSide = selectedSide ?? retained?.pick.side;
  /**
   * A spread on a button is an *offer* — "take this side at this price" — and a
   * spread on a pick is a *holding*. They agree until the line moves, and this
   * row used to render the live number in both roles: a locked pick showed a
   * price it was never bought at, and a *held* one showed the new number on a
   * highlighted button, which reads as "you picked this" however the copy
   * beside it is worded.
   *
   * So the held side shows what the member owns, and the opposite side keeps the
   * live line, because taking it genuinely would cost that. The asymmetry is the
   * information — it is what a moved line looks like.
   *
   * Accepting is a week-level act (it re-prices every unstarted pick), so it
   * only unfreezes an *editable* row: a locked pick is retained server-side at
   * the number it was made against, whatever the member accepts afterwards.
   */
  const storedPriceSide = storedPriceSideFor({
    committedSide: committedPick?.side,
    selectedSide,
    editable,
    spreadsAccepted,
  });
  const spreadFor = (side: PickemPickSide) =>
    showSpread
      ? spreadLabel(side === storedPriceSide ? (committedPick?.spread ?? null) : game.spread, side)
      : null;
  const awaySpread = spreadFor(PICKEM_PICK_SIDE.AWAY);
  const homeSpread = spreadFor(PICKEM_PICK_SIDE.HOME);
  // Only where a holding actually survives and its number disagrees with the
  // live one. A locked row already shows what it holds, an accepted one has no
  // gap left, and a switched one has no holding left to report.
  //
  // Carried as one object rather than a boolean so the side the two labels are
  // signed against comes from the same narrowing that decided to show them.
  // Split apart, each label needs its own fallback for a case this condition has
  // already excluded — and a defaulted side renders the spread with the *wrong
  // sign*, which is worse than rendering nothing.
  const movedLine =
    showSpread && editable && storedPriceSide !== null && committedPick?.spread !== game.spread
      ? { side: storedPriceSide, held: committedPick?.spread ?? null }
      : null;
  // Only ever on a retained pick — an editable one, by definition, is on a game
  // that hasn't started, so it can have no result (arch D10).
  const outcome = retained?.pick.outcome ?? null;
  // Locked/unplayable still outrank a held pick for the row highlight — those
  // say "you can't act here", which is the more useful thing to see while
  // scanning; the buttons below carry the who-did-I-pick answer in every state.
  const rowState = pickRowState(game, heldSide !== undefined);
  const stateAsOf = gameStateAsOfLabel(game);
  // Read off the *pick's* accepted spread, never the game's current one, so it
  // matches what settlement grades on. Which phrasing (a provisional reading
  // while it runs, the bare magnitude once graded) is the helper's rule, not
  // this row's.
  const standing = retained
    ? pickStandingLabel(
        game,
        { side: retained.pick.side, spreadAtPick: retained.pick.spread, outcome },
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
      <p className="text-xs text-muted-foreground">{gameStateLabel(game, now)}</p>
      {/* Own line, not appended to the state line above: this row has the
          room, and the qualifier reads more clearly set apart from the score
          it's dating than crowded onto the same line (DATA-8; spec §UI
          conventions — a stored clock reading can be minutes stale). */}
      {stateAsOf && <p className="text-xs text-muted-foreground/70">{stateAsOf}</p>}

      {/* Flags the gap without offering to close it here. The accept action is
          week-level and lives in the action bar, because taking the new number
          re-prices every unstarted pick — a per-row button would say the
          opposite. Deliberately not a warning tone: spreads drift all week, so
          meeting one that moved is the ordinary case. */}
      {movedLine && (
        <p className="text-xs text-muted-foreground">
          Line moved to {spreadLabel(game.spread, movedLine.side)} — your pick holds{" "}
          {spreadLabel(movedLine.held, movedLine.side)}.
        </p>
      )}

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
              there is already saying "In progress" or how it graded, which is
              the game's news. */}
          <p className="text-xs text-muted-foreground">
            {retained
              ? `Your pick: ${
                  retained.pick.side === PICKEM_PICK_SIDE.HOME
                    ? game.homeTeam.abbreviation
                    : game.awayTeam.abbreviation
                }`
              : "No pick"}
            {standing && ` · ${standing}`}
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
