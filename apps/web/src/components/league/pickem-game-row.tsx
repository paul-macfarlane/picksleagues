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
  gameStateLead,
  isClosedToPicks,
  matchupNumerals,
  spreadLabel,
} from "@/lib/game";
import { pickemPickGrade, pickRowState, pickStandingLabel } from "@/lib/pickem-game";
import { useAppNow } from "@/lib/app-clock";
import { kickoffDaysAway } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GameStatePill } from "@/components/league/game-state";
import { MatchupLine, MatchupSide } from "@/components/league/matchup-line";
import { NflMatchupStats } from "@/components/league/nfl-matchup-stats-sheet";
import {
  PickOutcomeBadge,
  PickOutcomeIcon,
  pickOutcomeAccentClassName,
  pickOutcomeButtonClassName,
} from "@/components/league/pick-outcome";
import { rowClassName, rowRuleClassName } from "@/components/row";
import { StatusPill } from "@/components/status-pill";

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
 * A held side carries a glyph only once a grade exists — settled, or derived
 * from the game's own terminal state (PKM-11, `pickemPickGrade`) — and then it
 * is the *outcome's* glyph. An undecided pick gets the fill alone: a checkmark
 * on one reads as "you got this right" rather than "you chose this", and on a
 * game that hasn't finished there is no such fact — the app would be claiming
 * an outcome it doesn't have. The fill, the row's rule, and the badge carry
 * "chosen" between them until a verdict exists.
 */
function SideButton({
  team,
  numeral,
  side,
  held,
  outcome,
  disabled,
  onClick,
}: {
  team: SlateGame["homeTeam"];
  numeral: string | null;
  side: PickemPickSide;
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
        // The sheet's primary tap, a 44pt target at every width (MOB-1), and
        // tall enough for the display-type cell inside it; the control hugs
        // its outer edge so the two numerals on the line face each other
        // across the centre column, and the home side mirrors so its outcome
        // glyph sits on the outer edge too.
        "h-auto min-h-11 w-full max-w-xs justify-start px-2 py-1.5",
        side === PICKEM_PICK_SIDE.HOME && "flex-row-reverse",
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
      <MatchupSide team={team} numeral={numeral} side={side} />
    </Button>
  );
}

/**
 * The row's identity as data: which two teams it is between, rather
 * than the `"<away> @ <home>"` line it happens to print. The merge-gate journey
 * addresses rows through these, so rewording or re-laying-out a matchup can't
 * fail the gate — while a row rendered for the wrong game still does.
 */
function gameRowAttributes(game: SlateGame) {
  return {
    "data-testid": "game-row",
    "data-away-team": game.awayTeam.abbreviation,
    "data-home-team": game.homeTeam.abbreviation,
  } as const;
}

const ROW_CLASS_NAME = cn(rowClassName, rowRuleClassName, "flex flex-col gap-2");

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
  const numerals = matchupNumerals(game, showSpread ? game.spread : null);

  return (
    <li
      {...gameRowAttributes(game)}
      className={cn(
        ROW_CLASS_NAME,
        // The rule says "selected" in the one colour that means it (ADR-0043
        // §3); full-strength, because a fraction of it sits too close to the
        // hairline to survive scanning a 16-game slate.
        pickRowState(game, selectedSide !== undefined) === "picked" && "border-l-primary",
      )}
    >
      {/* The line *is* the game's state (ADR-0043 §5): its numeral slots hold
          the spread now and the score once the game starts, and its centre
          the kickoff, phrased against the app clock — which under the
          simulator is months from the browser's. */}
      <MatchupLine
        data-testid="game-state"
        data-kickoff-days={kickoffDaysAway(game.kickoffAt, now)}
        away={
          <SideButton
            team={game.awayTeam}
            numeral={numerals.away}
            side={PICKEM_PICK_SIDE.AWAY}
            held={selectedSide === PICKEM_PICK_SIDE.AWAY}
            outcome={null}
            disabled={noLineYet || buttonsDisabled}
            onClick={() => onToggle(PICKEM_PICK_SIDE.AWAY)}
          />
        }
        center={gameStateLead(game, now)}
        home={
          <SideButton
            team={game.homeTeam}
            numeral={numerals.home}
            side={PICKEM_PICK_SIDE.HOME}
            held={selectedSide === PICKEM_PICK_SIDE.HOME}
            outcome={null}
            disabled={noLineYet || buttonsDisabled}
            onClick={() => onToggle(PICKEM_PICK_SIDE.HOME)}
          />
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <NflMatchupStats game={game} />
        {selectedSide !== undefined && <StatusPill tone="strong">Picked</StatusPill>}
        {noLineYet && <StatusPill>No line yet</StatusPill>}
      </div>
    </li>
  );
}

/**
 * A row in a submitted week: the pick, frozen (ADR-0018 decision 1).
 *
 * Every number here is `pick.spread` — the line the member accepted at
 * submission — never `game.spread`. The line keeps moving after a submission
 * and the current one is true about nothing here: settlement grades this pick
 * against what it was bought at, so showing anything else would put a number
 * on screen that no longer decides anything. Before kickoff that number sits in
 * the cells' numeral slots; once the score takes the slots it moves to the
 * pick summary, beside the standing it explains.
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
  const numerals = matchupNumerals(game, showSpread ? pick.spread : null);
  const heldSpread = showSpread ? spreadLabel(pick.spread, pick.side) : null;
  // Read once for the badge precedence below; `GameStatePill` re-checks it, so
  // the two can't disagree about which status counts as live.
  const inProgress = game.status === GAME_STATUS.IN_PROGRESS;
  const rowState = pickRowState(game, true);
  const stateAsOf = gameStateAsOfLabel(game);
  // Read off the *pick's* accepted spread, never the game's current one, so it
  // matches what settlement grades on. Which phrasing (a provisional reading
  // while it runs, the past tense once graded) is the helper's rule, not this
  // row's.
  const gradable = { side: pick.side, spreadAtPick: pick.spread, outcome: pick.outcome };
  // The settled grade when it exists, else the one derived from the final
  // score (PKM-11): the two can never disagree for a single pick, so the
  // member sees their verdict the moment the game ends instead of a sync
  // interval later.
  const grade = pickemPickGrade(game, gradable, pickType);
  const standing = pickStandingLabel(game, gradable, pickType);
  const heldTeam = pick.side === PICKEM_PICK_SIDE.HOME ? game.homeTeam : game.awayTeam;

  return (
    <li
      {...gameRowAttributes(game)}
      // The rule says the most that is known: the grade — settled or derived —
      // once there is one, "selected" in orange while the pick is still the
      // member's live holding, nothing once the game has closed with no
      // derivable verdict (final without scores) — the held control still
      // answers "who did I take".
      className={cn(
        ROW_CLASS_NAME,
        grade ? pickOutcomeAccentClassName(grade) : rowState === "picked" && "border-l-primary",
      )}
    >
      {/* Spread before the game starts, score after — a member whose pick has
          locked wants to know how it is doing, not what they bought it at. */}
      <MatchupLine
        data-testid="game-state"
        data-kickoff-days={kickoffDaysAway(game.kickoffAt, now)}
        away={
          <SideButton
            team={game.awayTeam}
            numeral={numerals.away}
            side={PICKEM_PICK_SIDE.AWAY}
            held={pick.side === PICKEM_PICK_SIDE.AWAY}
            outcome={grade}
            disabled
          />
        }
        center={gameStateLead(game, now)}
        home={
          <SideButton
            team={game.homeTeam}
            numeral={numerals.home}
            side={PICKEM_PICK_SIDE.HOME}
            held={pick.side === PICKEM_PICK_SIDE.HOME}
            outcome={grade}
            disabled
          />
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <NflMatchupStats game={game} />
          {/* Beside the stats trigger rather than under the score it dates:
              the qualifier reads as a footnote to the line, dimmer so it can't
              be mistaken for a live badge (DATA-8; spec §UI conventions — a
              stored clock reading can be minutes stale). */}
          {stateAsOf && <span className="text-xs text-muted-foreground/70">{stateAsOf}</span>}
        </div>
        {/* One badge, most-informative-wins, and the chain is total because
            each state strictly implies the next: a graded pick — settled or
            derived — takes the slot from "Locked" (every graded pick is
            locked, so the lock is implied and the grade is worth more), and an
            in-progress game takes it from "Locked" too — it has kicked off by
            definition, and "still being played" is the fact that separates it
            from the finished games above it and the unstarted ones below. No
            status badge for unplayable games — the line's centre carries the
            status for every non-scheduled game, and repeating "Cancelled"
            twelve pixels apart reads as a rendering bug. */}
        {grade ? (
          <PickOutcomeBadge outcome={grade} />
        ) : inProgress ? (
          <GameStatePill status={game.status} />
        ) : rowState === "picked" ? (
          <StatusPill tone="strong">Picked</StatusPill>
        ) : (
          game.locked && <StatusPill data-testid="lock-state">Locked</StatusPill>
        )}
      </div>

      {/* Only once the game has closed. Before kickoff the highlighted control
          already answers "who did I take", and a second statement of it beside
          an unstarted game is noise; afterwards both controls are dimmed, the
          slots hold the score, and this line carries the answer — with the
          line it was bought at, now that the slot no longer shows it — plus
          how the pick is doing. */}
      {isClosedToPicks(game) && (
        <div className="flex flex-col gap-2">
          {/* The standing rides on this line rather than the badge slot above
              because it is a fact about the *pick*, not the game — the badge
              there is already saying "In progress" or how it graded, which is
              the game's news. */}
          <p data-testid="pick-summary" className="text-xs text-muted-foreground">
            {`Your pick: ${heldTeam.abbreviation}`}
            {heldSpread && ` ${heldSpread}`}
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
