import { GAME_SIDE, type SlateGame, type SlateTeam } from "@picksleagues/schemas";
import { gameStateLabel, isClosedToPicks, spreadLabel } from "@/lib/game";
import { useAppNow } from "@/lib/app-clock";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { TeamLogo } from "@/components/team-logo";

/**
 * One game on the Survivor pick sheet: both of its teams as pick controls.
 *
 * Survivor picks a *team*, not a side, so unlike `pickem-game-row.tsx` there is
 * no home/away semantic behind the two buttons — they are simply the two teams
 * this game makes available, and taking either one replaces whatever the member
 * held elsewhere in the week.
 *
 * Split out of `survivor-picks.tsx`, which owns the week's selection and its
 * one write, for the same reason Pick'em's row is: a row's rendering is its own
 * responsibility.
 */

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
  frozen: boolean,
  noLineYet: boolean,
): string | null {
  if (consumedTeamIds.has(team.id)) return "already used this season";
  if (frozen) return "this week's pick is locked in";
  if (!game.pickable) return "this game was cancelled";
  if (game.locked) return "this game has kicked off";
  if (noLineYet) return "no spread posted yet";
  return null;
}

function TeamButton({
  team,
  spread,
  held,
  consumed,
  reason,
  onSelect,
}: {
  team: SlateTeam;
  spread: string | null;
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
      // carries no state a screen reader could infer the cause from: "Bills, +3,
      // already used this season" is the reason; a greyed box is not.
      aria-label={[team.name, spread, reason].filter(Boolean).join(", ")}
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
      {spread && ` ${spread}`}
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
  showSpread,
  heldTeamId,
  consumedTeamIds,
  frozen,
  onSelect,
}: {
  game: SlateGame;
  showSpread: boolean;
  /** The team held in *this* game, or null when the member's pick is elsewhere. */
  heldTeamId: string | null;
  /** The viewer's burned teams, already excluding this week (the API's rule). */
  consumedTeamIds: ReadonlySet<string>;
  /** The week can take no further change — the pick already on record has kicked off. */
  frozen: boolean;
  onSelect: (teamId: string) => void;
}) {
  const now = useAppNow();
  // ATS leagues can't accept a pick with no number to accept — the write path
  // refuses it (`spread_unavailable`) — so both teams are dead until the odds
  // sync posts a line.
  const noLineYet = showSpread && game.spread === null;
  const closed = isClosedToPicks(game);
  const awayConsumed = consumedTeamIds.has(game.awayTeam.id);
  const homeConsumed = consumedTeamIds.has(game.homeTeam.id);
  const reasonFor = (team: SlateTeam) =>
    unavailableReason(team, game, consumedTeamIds, frozen, noLineYet);

  return (
    <li
      // The row's identity as data rather than the "<away> @ <home>" line it
      // prints, so rewording or re-laying-out a matchup can't fail a journey
      // spec while a row rendered for the wrong game still does.
      data-testid="survivor-game-row"
      data-away-team={game.awayTeam.abbreviation}
      data-home-team={game.homeTeam.abbreviation}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border p-3",
        heldTeamId !== null && "border-primary bg-primary/5",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-sm font-medium text-foreground"
          title={`${game.awayTeam.name} @ ${game.homeTeam.name}`}
        >
          {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
        </p>
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
        {noLineYet && !closed && <StatusPill>No line yet</StatusPill>}
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
          // Dropped entirely on a consumed team: the line is a number they can
          // no longer take, and at 390px the "used" marker needs the room more.
          spread={showSpread && !awayConsumed ? spreadLabel(game.spread, GAME_SIDE.AWAY) : null}
          held={heldTeamId === game.awayTeam.id}
          consumed={awayConsumed}
          reason={reasonFor(game.awayTeam)}
          onSelect={() => onSelect(game.awayTeam.id)}
        />
        <TeamButton
          team={game.homeTeam}
          spread={showSpread && !homeConsumed ? spreadLabel(game.spread, GAME_SIDE.HOME) : null}
          held={heldTeamId === game.homeTeam.id}
          consumed={homeConsumed}
          reason={reasonFor(game.homeTeam)}
          onSelect={() => onSelect(game.homeTeam.id)}
        />
      </div>
    </li>
  );
}
