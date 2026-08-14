import {
  GAME_STATUS,
  isUnplayedStatus,
  type PickOutcome,
  type SlateGame,
  type SlateTeam,
} from "@picksleagues/schemas";
import { gameStateLabel, survivorProvisionalOutcome } from "@/lib/game";
import { useAppNow } from "@/lib/app-clock";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NflMatchupStats } from "@/components/league/nfl-matchup-stats-sheet";
import {
  PickOutcomeBadge,
  PickOutcomeIcon,
  pickOutcomeButtonClassName,
} from "@/components/league/pick-outcome";
import { StatusPill } from "@/components/status-pill";
import { TeamLogo } from "@/components/team-logo";

/**
 * A game's row on the Survivor pick screen, in the two shapes the week leaves
 * it in for its owner: `SurvivorGameRow` while the member can still choose,
 * `SurvivorPickedGameRow` once their pick is frozen and the row is a record
 * rather than an offer.
 *
 * Survivor picks a *team*, not a side, so unlike `pickem-game-row.tsx` there is
 * no home/away semantic behind the two controls — they are simply the two teams
 * this game makes available, and taking either one replaces whatever the member
 * held elsewhere in the week.
 *
 * Split out of `survivor-picks.tsx`, which owns the week's selection and its
 * one write, for the same reason Pick'em's rows are: a row's rendering is its
 * own responsibility.
 */

const ROW_CLASS_NAME = "flex flex-col gap-2 rounded-lg border border-border p-3";

/**
 * The row's identity as data rather than the "<away> @ <home>" line it prints,
 * so rewording or re-laying-out a matchup can't fail a journey spec while a row
 * rendered for the wrong game still does.
 */
function gameRowAttributes(game: SlateGame) {
  return {
    "data-testid": "survivor-game-row",
    "data-away-team": game.awayTeam.abbreviation,
    "data-home-team": game.homeTeam.abbreviation,
  } as const;
}

function MatchupLine({ game }: { game: SlateGame }) {
  return (
    <p
      className="text-sm font-medium text-foreground"
      title={`${game.awayTeam.name} @ ${game.homeTeam.name}`}
    >
      {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
    </p>
  );
}

/**
 * Why a team can't be taken, as a phrase that completes "…, <reason>". Null
 * means it can.
 *
 * Order is by durability, not by severity: a consumed team stays unavailable for
 * the rest of the season however this particular game is going, so it is the
 * answer worth giving even when the game is also closed.
 */
function unavailableReason(
  team: SlateTeam,
  game: SlateGame,
  consumedTeamIds: ReadonlySet<string>,
): string | null {
  if (consumedTeamIds.has(team.id)) return "already used this season";
  if (!game.pickable) return "this game was cancelled";
  if (game.locked) return "this game has kicked off";
  return null;
}

function TeamButton({
  team,
  held,
  consumed,
  reason,
  onSelect,
}: {
  team: SlateTeam;
  held: boolean;
  consumed: boolean;
  reason: string | null;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant={held ? "default" : "outline"}
      aria-pressed={held}
      // The whole sentence, because the control is `disabled` and therefore
      // carries no state a screen reader could infer the cause from: "Bills,
      // already used this season" is the reason; a greyed box is not.
      aria-label={[team.name, reason].filter(Boolean).join(", ")}
      title={reason ? `${team.name} — ${reason}` : team.name}
      data-testid="survivor-team-pick"
      data-team={team.abbreviation}
      className={cn(
        // A held team spends the rest of the week disabled once its game kicks
        // off, so it lifts out of the standard disabled dimming enough to stay
        // readable beside its outline sibling (same treatment as Pick'em's held
        // side).
        held && "disabled:opacity-75",
      )}
      disabled={reason !== null}
      onClick={onSelect}
    >
      <TeamLogo logoLightUrl={team.logoLightUrl} logoDarkUrl={team.logoDarkUrl} size="sm" />
      {team.abbreviation}
      {/* Visible, not only in the accessible name: the one rule a Survivor
          member has to hold in their head all season is which teams they've
          spent, and a dimmed button alone doesn't distinguish "used" from
          "kicked off". */}
      {consumed && <span className="text-xs font-normal">used</span>}
    </Button>
  );
}

export function SurvivorGameRow({
  game,
  heldTeamId,
  consumedTeamIds,
  onSelect,
}: {
  game: SlateGame;
  /** The team held in *this* game, or null when the member's pick is elsewhere. */
  heldTeamId: string | null;
  /** The viewer's burned teams, already excluding this week (the API's rule). */
  consumedTeamIds: ReadonlySet<string>;
  onSelect: (teamId: string) => void;
}) {
  const now = useAppNow();
  const awayConsumed = consumedTeamIds.has(game.awayTeam.id);
  const homeConsumed = consumedTeamIds.has(game.homeTeam.id);
  const reasonFor = (team: SlateTeam) => unavailableReason(team, game, consumedTeamIds);

  return (
    <li
      {...gameRowAttributes(game)}
      className={cn(ROW_CLASS_NAME, heldTeamId !== null && "border-primary bg-primary/5")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <MatchupLine game={game} />
          <NflMatchupStats game={game} />
        </div>
        {/* One pill, most-informative-wins: "Your pick" is the fact the member
            came here for, and the state line below already carries the game's
            own status for every game that has started. */}
        {heldTeamId !== null ? (
          <StatusPill tone="accent" data-testid="survivor-pick-state">
            Your pick
          </StatusPill>
        ) : (
          game.locked && <StatusPill data-testid="lock-state">Locked</StatusPill>
        )}
      </div>

      {/* Kickoff before the game starts, status + score after — and phrased
          against the app clock, which under the simulator is months away from
          the browser's. */}
      <p data-testid="game-state" className="text-xs text-muted-foreground">
        {gameStateLabel(game, now)}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <TeamButton
          team={game.awayTeam}
          held={heldTeamId === game.awayTeam.id}
          consumed={awayConsumed}
          reason={reasonFor(game.awayTeam)}
          onSelect={() => onSelect(game.awayTeam.id)}
        />
        <TeamButton
          team={game.homeTeam}
          held={heldTeamId === game.homeTeam.id}
          consumed={homeConsumed}
          reason={reasonFor(game.homeTeam)}
          onSelect={() => onSelect(game.homeTeam.id)}
        />
      </div>
    </li>
  );
}

/**
 * One team of a game the member can no longer choose between: a record of who
 * they took, not an offer.
 *
 * The held side carries a glyph only once a grade exists — settled, or derived
 * from the game's own terminal state (FB-23) — and then it is the *outcome's*
 * glyph: a checkmark on an undecided pick would read as "you got this right"
 * rather than "you chose this", a claim the app doesn't have until the game
 * ends (arch D10; the derivation is `survivorProvisionalOutcome`'s contract).
 */
function HeldTeamButton({
  team,
  held,
  outcome,
}: {
  team: SlateTeam;
  held: boolean;
  outcome: PickOutcome | null;
}) {
  // A grade belongs to the team that was taken; the other side is only context.
  const grade = held ? outcome : null;
  return (
    <Button
      type="button"
      // A graded side reads through its outcome colour, which needs the outline
      // shape to show against — the filled `default` would bury it.
      variant={held && grade === null ? "default" : "outline"}
      aria-pressed={held}
      title={team.name}
      className={cn(
        // This control spends its whole life disabled, so a held one lifts out
        // of the standard disabled dimming enough to stay readable beside its
        // outline sibling (same treatment as Pick'em's held side).
        held && "disabled:opacity-75",
        grade !== null && pickOutcomeButtonClassName(grade),
      )}
      disabled
    >
      {grade !== null && <PickOutcomeIcon outcome={grade} />}
      <TeamLogo logoLightUrl={team.logoLightUrl} logoDarkUrl={team.logoDarkUrl} size="sm" />
      {team.abbreviation}
    </Button>
  );
}

/**
 * What the sheet still has to say about a finished game the week hasn't graded
 * (FB-23: the *verdict* now comes from the derived provisional outcome, so this
 * carries only what that badge can't). A cancellation keeps its team-return
 * explanation — settlement is what hands the team back (spec §Game Mode 2 —
 * Cancelled game), and until then it sits on the used list with nothing else
 * saying why. A final without scores keeps the old ungraded paragraph, because
 * with no derivable verdict the badge slot is empty again. Everything else gets
 * one short line naming why the grade is provisional at all.
 *
 * Null while the game is still ahead or in play: the state line already says
 * so, and "not graded yet" about a game nobody has finished is noise.
 */
function ungradedNote(
  game: SlateGame,
  outcome: PickOutcome | null,
  provisional: PickOutcome | null,
): string | null {
  if (outcome !== null) return null;
  if (isUnplayedStatus(game.status)) {
    return "This game was cancelled, so it can't put you out — but your team only comes back to you when the week is graded, after every other game in it has finished.";
  }
  if (game.status !== GAME_STATUS.FINAL) return null;
  if (provisional === null) {
    return "This week hasn't been graded yet, so your pick doesn't have a result on it — grading runs once every game in the week has finished.";
  }
  return "Official grading lands once every game in the week has finished.";
}

/**
 * The one game the member's pick is in, for a week that can take no further
 * change: the matchup, both its teams with theirs held, and the grade once the
 * week has been settled.
 *
 * A separate component from `SurvivorGameRow` rather than a flag on it, for the
 * reason `pickem-game-row.tsx` splits its two: this row makes no offer, so it
 * has no consumed-team ledger to honour and no reason to explain — the member
 * cannot act on any of it.
 */
export function SurvivorPickedGameRow({
  game,
  teamId,
  outcome,
}: {
  game: SlateGame;
  /** The team the member holds — always one of this game's two. */
  teamId: string;
  outcome: PickOutcome | null;
}) {
  const now = useAppNow();
  const heldTeam = teamId === game.homeTeam.id ? game.homeTeam : game.awayTeam;
  // The settled grade when it exists, else the derived one (FB-23): the two can
  // never disagree for a single pick, so the member sees their verdict the
  // moment the game ends instead of after Monday night's settlement.
  const grade = outcome ?? survivorProvisionalOutcome(game, teamId);
  const note = ungradedNote(game, outcome, grade);

  return (
    <li
      {...gameRowAttributes(game)}
      // Which team the row is a record of, beside the matchup it sits in: the
      // held control is addressed by its `aria-pressed` state, and a journey
      // asking "what did I end up with" wants the answer as data.
      data-picked-team={heldTeam.abbreviation}
      className={cn(ROW_CLASS_NAME, "border-primary bg-primary/5")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <MatchupLine game={game} />
          <NflMatchupStats game={game} />
        </div>
        {/* One pill, most-informative-wins: a graded pick — settled or derived
            — takes the slot from "Your pick", which by then is both implied and
            the less interesting fact. */}
        {grade ? (
          <PickOutcomeBadge outcome={grade} />
        ) : (
          <StatusPill tone="accent" data-testid="survivor-pick-state">
            Your pick
          </StatusPill>
        )}
      </div>

      <p data-testid="game-state" className="text-xs text-muted-foreground">
        {gameStateLabel(game, now)}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <HeldTeamButton team={game.awayTeam} held={teamId === game.awayTeam.id} outcome={grade} />
        <HeldTeamButton team={game.homeTeam} held={teamId === game.homeTeam.id} outcome={grade} />
      </div>

      {note && (
        <p data-testid="survivor-grade-state" className="text-xs text-muted-foreground">
          {note}
        </p>
      )}
    </li>
  );
}
