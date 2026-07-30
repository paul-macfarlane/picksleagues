import {
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  type PickType,
  type PickemMemberPicks,
  type PickemPick,
  type SlateGame,
} from "@picksleagues/schemas";
import { useWeekPicks } from "@/api/pickem";
import { useWeekSlate } from "@/api/weeks";
import { gameStateAsOfLabel, gameStateLabel, pickStandingLabel, spreadLabel } from "@/lib/game";
import { useErrorToast } from "@/lib/use-error-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { UserIdentity } from "@/components/user-identity";
import { GameStatePill } from "@/components/league/game-state";
import { PickOutcomeBadge } from "@/components/league/pick-outcome";

// One pick per row, and each row is a two-line block at phone width: what the
// member took on the first line, where that game stands on the second
// (feedback round 4). Previously both lines were a single wrapping flex row, so
// a short matchup happened to fit beside its status while a long one wrapped —
// the same information landed in a different place on every row, which is what
// made the list hard to read. Widening to `sm` restores the one-line,
// state-pushed-right layout, where the room actually exists.
const PICK_ROW_CLASS_NAME =
  "flex flex-col gap-0.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2";

// The week/pick detail screen (spec Screens inventory): every member's picks
// for one week, joined against that week's slate so each pick renders as a
// real matchup rather than a bare game id. Visibility is already enforced by
// the API (`picks` only contains kicked-off games for non-viewers); this
// component never re-derives that rule, only renders what it was given.
export function PickemWeekDetail({
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

  useErrorToast(
    slate.isError || picks.isError,
    "Couldn't load this week's picks — please try again.",
  );

  const gameById = new Map((slate.data?.games ?? []).map((game) => [game.id, game]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{slate.data && picks.data ? `Picks — ${slate.data.label}` : "Picks"}</CardTitle>
        {slate.data && picks.data && (
          <CardDescription>Each pick is revealed once its game kicks off.</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <QueryState
          isPending={slate.isPending || picks.isPending}
          pendingMessage="Loading this week's picks…"
          isError={slate.isError || picks.isError}
          onRetry={() => {
            void slate.refetch();
            void picks.refetch();
          }}
          errorMessage="Couldn't load this week's picks."
        >
          {slate.data && picks.data && (
            <div className="flex flex-col gap-4">
              {picks.data.members.map((member) => (
                <MemberPicksRow
                  key={member.leagueMemberId}
                  member={member}
                  gameById={gameById}
                  pickType={pickType}
                />
              ))}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function MemberPicksRow({
  member,
  gameById,
  pickType,
}: {
  member: PickemMemberPicks;
  gameById: Map<string, SlateGame>;
  pickType: PickType;
}) {
  return (
    // The testid is the E2E seam for this row: the pick-visibility assertions
    // (PKM-8) otherwise have to walk up from the display-name text node, which
    // re-breaks on any layout change. Specs narrow to one member by filtering
    // these on the name they already know.
    <div
      data-testid="member-picks-row"
      className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0"
    >
      <UserIdentity
        displayName={member.displayName}
        username={member.username}
        image={member.image}
        isViewer={member.isViewer}
        avatarSize="sm"
      />

      {member.picks.length === 0 && member.hiddenPickCount === 0 && (
        <p className="pl-8 text-xs text-muted-foreground">No picks submitted.</p>
      )}

      {member.picks.length > 0 && (
        <ul className="flex flex-col gap-1.5 pl-8">
          {member.picks.map((pick) => (
            <PickRow
              key={pick.id}
              pick={pick}
              game={gameById.get(pick.gameId)}
              pickType={pickType}
            />
          ))}
        </ul>
      )}

      {/* Rendered as a count, never as placeholder rows implying content
          (spec §Pick Visibility) — the games behind it haven't kicked off. */}
      {member.hiddenPickCount > 0 && (
        <p className="pl-8 text-xs text-muted-foreground">
          {member.hiddenPickCount} more pick{member.hiddenPickCount === 1 ? "" : "s"} in — not yet
          revealed.
        </p>
      )}
    </div>
  );
}

function PickRow({
  pick,
  game,
  pickType,
}: {
  pick: PickemPick;
  game: SlateGame | undefined;
  pickType: PickType;
}) {
  // A miss here is expected, not a disagreement between the endpoints: picks
  // are read by the week they were *made* in, while the slate is the games
  // currently *in* that week. A provider week move repoints the game and leaves
  // the pick behind (ADR-0015), and the server still reveals that pick at the
  // game's own kickoff — so dropping the row would hide a revealed pick from
  // both this week's view and the week it moved to. The matchup isn't
  // renderable without the game, but the outcome is the point: it pushes.
  if (!game) {
    return (
      <li className={PICK_ROW_CLASS_NAME}>
        <span className="text-muted-foreground">Pick on a game that moved out of this week</span>
        <span className="text-muted-foreground">Push</span>
      </li>
    );
  }

  const pickedTeam = pick.side === PICKEM_PICK_SIDE.HOME ? game.homeTeam : game.awayTeam;
  const showSpread = pickType === PICK_TYPE.AGAINST_THE_SPREAD;
  const spread = showSpread
    ? spreadLabel(pick.spread, pick.side === PICKEM_PICK_SIDE.HOME ? "home" : "away")
    : null;
  const stateAsOf = gameStateAsOfLabel(game);
  // Literally the same rule as the pick editor's rows, via the same function.
  // Shown for every member's revealed pick, not just the viewer's — a pick
  // visible here has kicked off, so this discloses nothing the visibility rule
  // doesn't already allow.
  const standing = pickStandingLabel(
    game,
    { side: pick.side, spreadAtPick: pick.spread, outcome: pick.outcome },
    pickType,
  );

  return (
    <li className={PICK_ROW_CLASS_NAME}>
      <span className="flex flex-wrap items-center gap-1.5 text-foreground">
        <TeamLogo
          logoLightUrl={pickedTeam.logoLightUrl}
          logoDarkUrl={pickedTeam.logoDarkUrl}
          size="sm"
        />
        {pickedTeam.abbreviation}
        {spread && ` ${spread}`}
        <span className="text-muted-foreground">
          ({game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation})
        </span>
        {/* Same badge the pick editor uses, so a member reading their own row
            here and there sees one vocabulary for how a pick graded. The badge
            owns the verdict and the standing beside it owns the magnitude —
            they pair on a graded pick, and the standing stands alone while the
            game is still running. */}
        {pick.outcome && <PickOutcomeBadge outcome={pick.outcome} />}
        {standing && <span className="text-muted-foreground">{standing}</span>}
      </span>
      {/* The "as of" qualifier is folded into this same line rather than given
          a block of its own: the row is already tight (unlike the pick-entry
          row, which has the room), so it trails the state text it's dating,
          dimmer still so it can't be mistaken for a live badge (DATA-8; spec
          §UI conventions). */}
      <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        <GameStatePill status={game.status} />
        <span>
          {gameStateLabel(game)}
          {stateAsOf && <span className="text-muted-foreground/70"> · {stateAsOf}</span>}
        </span>
      </span>
    </li>
  );
}
