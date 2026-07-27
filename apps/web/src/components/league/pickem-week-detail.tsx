import {
  GAME_STATUS,
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  type PickType,
  type PickemMemberPicks,
  type PickemPick,
  type SlateGame,
} from "@picksleagues/schemas";
import { useWeekPicks } from "@/api/pickem";
import { useWeekSlate } from "@/api/weeks";
import { formatDateTime } from "@/lib/format";
import { gameStatusLabel, scoreText, spreadLabel } from "@/lib/game";
import { initialsOf } from "@/lib/user";
import { useErrorToast } from "@/lib/use-error-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/query-state";

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
      <div className="flex items-center gap-2">
        <Avatar size="sm">
          <AvatarImage src={member.image ?? undefined} alt="" />
          <AvatarFallback>{initialsOf(member.displayName)}</AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-foreground">
          {member.displayName}
          {member.isViewer && <span className="text-muted-foreground"> (You)</span>}
        </span>
      </div>

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
      <li className="flex flex-wrap items-center justify-between gap-2 text-xs">
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

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-foreground">
        {pickedTeam.abbreviation}
        {spread && ` ${spread}`}
        <span className="text-muted-foreground">
          {" "}
          ({game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation})
        </span>
      </span>
      <span className="text-muted-foreground">
        {game.status === GAME_STATUS.SCHEDULED
          ? `Kickoff ${formatDateTime(game.kickoffAt)}`
          : `${gameStatusLabel(game.status)}${scoreText(game.awayScore, game.homeScore)}`}
      </span>
    </li>
  );
}
