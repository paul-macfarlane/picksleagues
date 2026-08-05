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
import { GameStatePill } from "@/components/league/game-state";
import {
  PickOutcomeBadge,
  PickOutcomeIcon,
  pickOutcomeButtonClassName,
} from "@/components/league/pick-outcome";
import { StatusPill } from "@/components/status-pill";
import { TeamLogo } from "@/components/team-logo";

/**
 * A game's row on the member's own pick screen, in the two shapes ADR-0018
 * leaves a week in for its owner: `SheetGameRow` while the week is still an
 * unsubmitted local sheet, `SubmittedPickRow` once the one submission has
 * landed and nothing in the week can change again.
 *
 * They are separate components rather than one row with a `readOnly` flag
 * because they answer different questions. The sheet row offers two sides at
 * the *live* line — an offer the member can still take. The submitted row
 * reports a holding at `spread_at_pick`, which is the number settlement will
 * grade it against, and has no offer left to make.
 *
 * Split out of `pickem-picks.tsx` — which owns the week's selection state and
 * submission — because a row's rendering is its own responsibility.
 */

/**
 * One side of a matchup as a pick control. `held` — not "selected" — because it
 * covers a submitted or settled pick just as much as a live selection: the fill
 * and `aria-pressed` are the row's answer to "who did I take", and that question
 * outlives the ability to change the answer.
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
  onClick?: () => void;
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
        // A held side spends most of its life disabled — a submitted week never
        // becomes editable again — so it lifts out of the standard disabled
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

function Matchup({ game }: { game: SlateGame }) {
  return (
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
  );
}

const ROW_CLASS_NAME = "flex flex-col gap-2 rounded-lg border border-border p-3";

/**
 * A row in the unsubmitted sheet. Only games the member can still pick reach
 * here (`pickem-picks.tsx` filters the slate), so there is no locked, cancelled,
 * or graded state to render — nothing on this row has happened yet.
 *
 * `buttonsDisabled` is the sheet's cap: adding a *new* pick is refused once the
 * sheet holds the week's full required set, while a held side always stays
 * operable, because giving it up is what frees the slot.
 */
export function SheetGameRow({
  game,
  pickType,
  selectedSide,
  buttonsDisabled,
  onToggle,
}: {
  game: SlateGame;
  pickType: PickType;
  selectedSide: PickemPickSide | undefined;
  buttonsDisabled: boolean;
  onToggle: (side: PickemPickSide) => void;
}) {
  const now = useAppNow();
  const showSpread = pickType === PICK_TYPE.AGAINST_THE_SPREAD;
  // ATS leagues can't submit a pick with no number to accept — the write path
  // refuses it (`spread_unavailable`) — so the side controls are dead until the
  // odds sync posts a line. The sheet says so above the Submit button too, since
  // this game still counts toward the required set and therefore holds the whole
  // week's submission until it has a number.
  const noLineYet = showSpread && game.spread === null;
  const spreadFor = (side: PickemPickSide) => (showSpread ? spreadLabel(game.spread, side) : null);

  return (
    <li
      className={cn(
        ROW_CLASS_NAME,
        // Full-strength `primary`, not a fraction of it: the palette is
        // achromatic, so a tinted border is the only row-level cue available
        // and a 50% one sits too close to `border` (white/10% in dark) to
        // survive scanning a 16-game slate.
        pickRowState(game, selectedSide !== undefined) === "picked" &&
          "border-primary bg-primary/5",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Matchup game={game} />
        {selectedSide !== undefined && <StatusPill tone="accent">Picked</StatusPill>}
        {noLineYet && <StatusPill>No line yet</StatusPill>}
      </div>

      <p className="text-xs text-muted-foreground">{gameStateLabel(game, now)}</p>

      <div className="grid grid-cols-2 gap-2">
        <SideButton
          team={game.awayTeam}
          spread={spreadFor(PICKEM_PICK_SIDE.AWAY)}
          held={selectedSide === PICKEM_PICK_SIDE.AWAY}
          outcome={null}
          disabled={noLineYet || buttonsDisabled}
          onClick={() => onToggle(PICKEM_PICK_SIDE.AWAY)}
        />
        <SideButton
          team={game.homeTeam}
          spread={spreadFor(PICKEM_PICK_SIDE.HOME)}
          held={selectedSide === PICKEM_PICK_SIDE.HOME}
          outcome={null}
          disabled={noLineYet || buttonsDisabled}
          onClick={() => onToggle(PICKEM_PICK_SIDE.HOME)}
        />
      </div>
    </li>
  );
}

/**
 * A row in a submitted week: the pick, frozen (ADR-0018 decision 1).
 *
 * Both sides render from `pick.spread` — the number the member accepted at
 * submission — never from `game.spread`. The line keeps moving after a
 * submission and the current one is true about nothing here: settlement grades
 * this pick against what it was bought at, so showing anything else would put a
 * number on screen that no longer decides anything.
 */
export function SubmittedPickRow({
  game,
  pick,
  pickType,
}: {
  game: SlateGame;
  pick: PickemPick;
  pickType: PickType;
}) {
  const now = useAppNow();
  const showSpread = pickType === PICK_TYPE.AGAINST_THE_SPREAD;
  const spreadFor = (side: PickemPickSide) => (showSpread ? spreadLabel(pick.spread, side) : null);
  // Read once for the badge precedence below; `GameStatePill` re-checks it, so
  // the two can't disagree about which status counts as live.
  const inProgress = game.status === GAME_STATUS.IN_PROGRESS;
  const rowState = pickRowState(game, true);
  const stateAsOf = gameStateAsOfLabel(game);
  // Read off the *pick's* accepted spread, never the game's current one, so it
  // matches what settlement grades on. Which phrasing (a provisional reading
  // while it runs, the bare magnitude once graded) is the helper's rule, not
  // this row's.
  const standing = pickStandingLabel(
    game,
    { side: pick.side, spreadAtPick: pick.spread, outcome: pick.outcome },
    pickType,
  );

  return (
    <li className={cn(ROW_CLASS_NAME, rowState === "picked" && "border-primary bg-primary/5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Matchup game={game} />
        {/* One badge, most-informative-wins, and the chain is total because
            each state strictly implies the next: a settled pick takes the slot
            from "Locked" (every settled pick is locked, so the lock is implied
            and the grade is worth more), and an in-progress game takes it from
            "Locked" too — it has kicked off by definition, and "still being
            played" is the fact that separates it from the finished games above
            it and the unstarted ones below. No status badge for unplayable
            games — the state line below carries the status for every
            non-scheduled game, and repeating "Cancelled" twelve pixels apart
            reads as a rendering bug. */}
        {pick.outcome ? (
          <PickOutcomeBadge outcome={pick.outcome} />
        ) : inProgress ? (
          <GameStatePill status={game.status} />
        ) : rowState === "picked" ? (
          <StatusPill tone="accent">Picked</StatusPill>
        ) : (
          game.locked && <StatusPill>Locked</StatusPill>
        )}
      </div>

      {/* Kickoff before the game starts, status + score after — a member whose
          pick has locked wants to know how it is doing, not when it began. */}
      <p className="text-xs text-muted-foreground">{gameStateLabel(game, now)}</p>
      {/* Own line, not appended to the state line above: this row has the
          room, and the qualifier reads more clearly set apart from the score
          it's dating than crowded onto the same line (DATA-8; spec §UI
          conventions — a stored clock reading can be minutes stale). */}
      {stateAsOf && <p className="text-xs text-muted-foreground/70">{stateAsOf}</p>}

      <div className="grid grid-cols-2 gap-2">
        <SideButton
          team={game.awayTeam}
          spread={spreadFor(PICKEM_PICK_SIDE.AWAY)}
          held={pick.side === PICKEM_PICK_SIDE.AWAY}
          outcome={pick.outcome}
          disabled
        />
        <SideButton
          team={game.homeTeam}
          spread={spreadFor(PICKEM_PICK_SIDE.HOME)}
          held={pick.side === PICKEM_PICK_SIDE.HOME}
          outcome={pick.outcome}
          disabled
        />
      </div>

      {/* Only once the game has closed. Before kickoff the highlighted button
          already answers "who did I take", and a second statement of it beside
          an unstarted game is noise; afterwards the buttons are both dimmed and
          the line carries the answer plus how the pick is doing. */}
      {isClosedToPicks(game) && (
        <div className="flex flex-col gap-2">
          {/* The standing rides on this line rather than the badge slot above
              because it is a fact about the *pick*, not the game — the badge
              there is already saying "In progress" or how it graded, which is
              the game's news. */}
          <p className="text-xs text-muted-foreground">
            {`Your pick: ${
              pick.side === PICKEM_PICK_SIDE.HOME
                ? game.homeTeam.abbreviation
                : game.awayTeam.abbreviation
            }`}
            {standing && ` · ${standing}`}
          </p>
          {/* The push stands, whatever else is left in the week (ADR-0018
              decision 3) — saying so is the whole reason a cancelled game keeps
              a visible row. */}
          {!game.pickable && (
            <p className="text-xs text-muted-foreground">
              This game was cancelled, so the pick resolved as a push — your other picks are
              unaffected.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
