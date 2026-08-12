import { ChevronDownIcon } from "lucide-react";
import {
  PICKEM_PICK_SIDE,
  PICK_TYPE,
  type PickType,
  type PickemMemberPicks,
  type PickemPick,
  type PickemStandingsRow,
  type SlateGame,
} from "@picksleagues/schemas";
import { usePickemStandings, useWeekPicks } from "@/api/pickem";
import { useWeekSlate } from "@/api/weeks";
import {
  gameStateAsOfLabel,
  gameStateLabel,
  pickStandingLabel,
  spreadLabel,
  spreadSourceCredit,
} from "@/lib/game";
import { useAppNow } from "@/lib/app-clock";
import { cn } from "@/lib/utils";
import { rankLabel, sharedRankCounts } from "@/lib/standings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RowsSkeleton } from "@/components/loading";
import { QueryState } from "@/components/query-state";
import { TeamLogo } from "@/components/team-logo";
import { UserIdentity } from "@/components/user-identity";
import { GameStatePill } from "@/components/league/game-state";
import { PickOutcomeBadge, pickOutcomeAccentClassName } from "@/components/league/pick-outcome";

// One pick per row: a padded block of stacked lines — what the member took,
// where the game stands, how far ahead or behind it left them — each a group of
// its own so no line ever wraps into another's territory, with the muted
// background separating one pick from the next where an unbounded text stack
// read as clutter (FB-12). One layout at every width on purpose (FB-24, owner's
// call): the block briefly reverted to an inline single line at `sm`, and the
// same list reading differently per device cost more than the desktop line
// saved.
//
// The frame carries a left rule the caller colours by outcome, and the block is
// `text-sm` rather than `text-xs` so its secondary lines have a baseline to drop
// below — a row where every line is the smallest size gives the eye no
// hierarchy to scan by, which is what made a week of these read as a wall
// (FB-42).
const PICK_ROW_CLASS_NAME =
  "flex flex-col gap-1 rounded-md border-l-2 bg-muted/40 py-2 pr-2 pl-2.5 text-sm";

function byMemberId(rows: readonly PickemStandingsRow[]): Map<string, PickemStandingsRow> {
  return new Map(rows.map((row) => [row.leagueMemberId, row]));
}

/**
 * Orders members by how they did *this week*, best first.
 *
 * The rank is the server's own (`pickem_standings`, spec §Standings: points
 * alone, ties sharing a rank) rather than a comparison invented here — two
 * surfaces disagreeing about who is first is worse than either order, and a
 * naive client sort would renumber ties the server deliberately shares.
 *
 * Nothing settled yet means no weekly rows at all, so unranked members fall
 * back to their season standing and finally to name, which keeps the order
 * stable from render to render instead of following whatever order the picks
 * endpoint happened to return.
 *
 * **This cannot leak a hidden pick.** Weekly points come only from *graded*
 * picks; grading requires a final game, and a final game has kicked off, so it
 * is already revealed (spec §Pick Visibility). A member's position here is
 * derived entirely from picks the viewer can see.
 */
export function orderMembersByWeek(
  members: readonly PickemMemberPicks[],
  weekRows: readonly PickemStandingsRow[],
  seasonRows: readonly PickemStandingsRow[],
): PickemMemberPicks[] {
  const week = byMemberId(weekRows);
  const season = byMemberId(seasonRows);
  // `Infinity` puts the unranked after everyone ranked with no separate branch
  // per tier. Compared, never subtracted: `1 - Infinity` is `-Infinity`, which
  // is a correct sign but not a usable tie test, and `Infinity - Infinity` is
  // `NaN`, which sorts arbitrarily.
  const rankOf = (rows: Map<string, PickemStandingsRow>, memberId: string) =>
    rows.get(memberId)?.rank ?? Infinity;
  const compare = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1);

  return [...members].sort((a, b) => {
    const byWeek = compare(rankOf(week, a.leagueMemberId), rankOf(week, b.leagueMemberId));
    if (byWeek !== 0) return byWeek;
    const bySeason = compare(rankOf(season, a.leagueMemberId), rankOf(season, b.leagueMemberId));
    if (bySeason !== 0) return bySeason;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * The week/pick detail screen (spec Screens inventory): every member's picks
 * for one week, joined against that week's slate so each pick renders as a
 * real matchup rather than a bare game id, and against both standings boards so
 * each member arrives with the record that explains their position. Visibility
 * is already enforced by the API (`picks` only contains kicked-off games for
 * non-viewers); this component never re-derives that rule, only renders what it
 * was given.
 */
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
  const weekStandings = usePickemStandings(leagueId, weekId);
  const seasonStandings = usePickemStandings(leagueId);

  const gameById = new Map((slate.data?.games ?? []).map((game) => [game.id, game]));
  // Standings are this screen's decoration, not its content, so a failure there
  // degrades to unranked rows with no records rather than blanking the picks —
  // hence they are absent from the QueryState below and from the toast above.
  const weekRows = weekStandings.data?.rows ?? [];
  const seasonRows = seasonStandings.data?.rows ?? [];
  const weekByMember = byMemberId(weekRows);
  const seasonByMember = byMemberId(seasonRows);
  const weekShared = sharedRankCounts(weekRows);
  const seasonShared = sharedRankCounts(seasonRows);
  // Once per surface, not per pick row (PKM-9) — the whole slate prices from
  // one provider response, so a per-row credit would repeat the same string.
  const credit = spreadSourceCredit(slate.data?.games ?? [], pickType);

  return (
    // The card is addressed by testid and identified by the week it is for:
    // the title reads "Picks — Week 1", of which only "Week 1" is a fact — the
    // rest is copy the facelift may reword.
    <Card data-testid="week-picks-card" data-week-label={slate.data?.label}>
      <CardHeader>
        <CardTitle>{slate.data && picks.data ? `Picks — ${slate.data.label}` : "Picks"}</CardTitle>
        {slate.data && picks.data && (
          <CardDescription>
            Best week first — open a member to see their picks. Each pick is revealed once its game
            kicks off.
          </CardDescription>
        )}
        {credit && (
          <p data-testid="spread-source-credit" className="text-xs text-muted-foreground/70">
            {credit}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <QueryState
          isPending={slate.isPending || picks.isPending}
          pendingFallback={
            <RowsSkeleton label="Loading this week's picks" rows={3} rowClassName="h-24 w-full" />
          }
          isError={slate.isError || picks.isError}
          onRetry={() => {
            void slate.refetch();
            void picks.refetch();
          }}
          errorMessage="Couldn't load this week's picks."
        >
          {slate.data && picks.data && (
            <div className="flex flex-col">
              {orderMembersByWeek(picks.data.members, weekRows, seasonRows).map((member) => (
                <MemberPicksSection
                  key={member.leagueMemberId}
                  member={member}
                  gameById={gameById}
                  pickType={pickType}
                  week={weekByMember.get(member.leagueMemberId)}
                  season={seasonByMember.get(member.leagueMemberId)}
                  weekShared={weekShared}
                  seasonShared={seasonShared}
                />
              ))}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function recordText(row: PickemStandingsRow): string {
  return `${row.wins}-${row.losses}-${row.pushes} · ${row.points} pts`;
}

function MemberPicksSection({
  member,
  gameById,
  pickType,
  week,
  season,
  weekShared,
  seasonShared,
}: {
  member: PickemMemberPicks;
  gameById: Map<string, SlateGame>;
  pickType: PickType;
  week: PickemStandingsRow | undefined;
  season: PickemStandingsRow | undefined;
  weekShared: Map<number, number>;
  seasonShared: Map<number, number>;
}) {
  // Joined here rather than inside the row so a pick without a game in this
  // week's slate is impossible by type below. Week moves are out of scope
  // (ADR-0019), so the join is total; were the provider to repoint a game
  // anyway, the pick still grades against that game's own result from wherever
  // it now sits and this view simply has no matchup to draw for it.
  const picked = member.picks.flatMap((pick) => {
    const game = gameById.get(pick.gameId);
    return game ? [{ pick, game }] : [];
  });

  return (
    // Native `<details>` rather than a disclosure component: collapsible,
    // keyboard-operable and screen-reader-announced with no state to own, and
    // the repo has no accordion primitive to reuse.
    //
    // Closed by default (owner's call), including the viewer's own row. With
    // the rank and both records in the header, the collapsed page is already a
    // weekly leaderboard, and opening a member is the question a reader
    // actually arrives with. Uniform rather than auto-expanding the viewer:
    // their own picks have a whole tab of their own, so expanding them here
    // would spend the one open row on the least useful member.
    //
    // The testid stays on the outer element: the pick-visibility assertions
    // (PKM-8) address this row rather than walking up from a display-name text
    // node, which would re-break on any layout change.
    <details data-testid="member-picks-row" className="group border-b border-border last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        {/* Fixed width so the ranks form a column the eye can run down, and
            an em dash rather than a blank while the week has yet to settle —
            an empty cell reads as a missing value. */}
        <span className="w-7 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {week ? rankLabel(week.rank, weekShared) : "—"}
        </span>
        <UserIdentity
          displayName={member.displayName}
          username={member.username}
          image={member.image}
          isViewer={member.isViewer}
          avatarSize="sm"
        >
          {/* The week leads because this is a week view; the season trails it,
              dimmer, as the context for whether a good week was typical. */}
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>Week {week ? recordText(week) : "not settled"}</span>
            {season && (
              <span className="text-muted-foreground/70">
                Season {recordText(season)} · rank {rankLabel(season.rank, seasonShared)}
              </span>
            )}
          </span>
        </UserIdentity>
        <ChevronDownIcon
          aria-hidden="true"
          className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="flex flex-col gap-2 pb-3">
        {picked.length === 0 && member.hiddenPickCount === 0 && (
          <p className="pl-9 text-xs text-muted-foreground">No picks submitted.</p>
        )}

        {picked.length > 0 && (
          // Shallow indent at every width: the blocks are set off by their
          // background rather than by alignment with the avatar column, and at
          // phone width the full indent would spend 36px of a ~375px viewport.
          <ul className="flex flex-col gap-2 pl-2">
            {picked.map(({ pick, game }) => (
              <PickRow key={pick.id} pick={pick} game={game} pickType={pickType} />
            ))}
          </ul>
        )}

        {/* Rendered as a count, never as placeholder rows implying content
            (spec §Pick Visibility) — the games behind it haven't kicked off. */}
        {member.hiddenPickCount > 0 && (
          <p data-testid="hidden-pick-count" className="pl-9 text-xs text-muted-foreground">
            {member.hiddenPickCount} more pick{member.hiddenPickCount === 1 ? "" : "s"} in — not yet
            revealed.
          </p>
        )}
      </div>
    </details>
  );
}

function PickRow({
  pick,
  game,
  pickType,
}: {
  pick: PickemPick;
  game: SlateGame;
  pickType: PickType;
}) {
  const now = useAppNow();
  const pickedTeam = pick.side === PICKEM_PICK_SIDE.HOME ? game.homeTeam : game.awayTeam;
  const showSpread = pickType === PICK_TYPE.AGAINST_THE_SPREAD;
  const spread = showSpread ? spreadLabel(pick.spread, pick.side) : null;
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
    // Identified as data rather than by the "(AWAY @ HOME)" text beside the
    // pick: the merge-gate journey has to find one member's row for one
    // specific game — and which side they took — without binding to how either
    // is worded.
    <li
      data-testid="member-pick"
      data-away-team={game.awayTeam.abbreviation}
      data-home-team={game.homeTeam.abbreviation}
      data-picked-team={pickedTeam.abbreviation}
      className={cn(PICK_ROW_CLASS_NAME, pickOutcomeAccentClassName(pick.outcome))}
    >
      {/* The pick and its verdict share the top line, pushed to opposite ends:
          down a member's list both land in a column, which is what makes a week
          scannable rather than readable. Same badge the pick editor uses, so a
          member reading their own row here and there sees one vocabulary for
          how a pick graded. */}
      <div className="flex items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
          <TeamLogo
            logoLightUrl={pickedTeam.logoLightUrl}
            logoDarkUrl={pickedTeam.logoDarkUrl}
            size="sm"
          />
          {pickedTeam.abbreviation}
          {spread && ` ${spread}`}
        </span>
        {pick.outcome && <PickOutcomeBadge outcome={pick.outcome} />}
      </div>
      {/* Everything about the game drops to the secondary line: the matchup on
          the left, its state on the right, under the two they belong to. The
          "as of" qualifier trails the state text it's dating, dimmer still so
          it can't be mistaken for a live badge (DATA-8; spec §UI conventions). */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <GameStatePill status={game.status} />
          <span>
            {gameStateLabel(game, now)}
            {stateAsOf && <span className="text-muted-foreground/70"> · {stateAsOf}</span>}
          </span>
        </span>
      </div>
      {/* The magnitude, under the verdict it qualifies: it pairs with the badge
          on a graded pick and stands alone while the game is still running. */}
      {standing && (
        <p data-testid="pick-standing" className="text-right text-xs text-muted-foreground">
          {standing}
        </p>
      )}
    </li>
  );
}
