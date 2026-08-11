import {
  PICK_OUTCOME,
  SURVIVOR_MEMBER_STATUS,
  type PickOutcome,
  type SlateTeam,
  type SurvivorStandingsMember,
  type SurvivorStandingsPick,
  type SurvivorStandingsPickGame,
  type SurvivorStandingsResponse,
} from "@picksleagues/schemas";
import { useSurvivorStandings } from "@/api/survivor";
import { useAppNow } from "@/lib/app-clock";
import { formatDateTime } from "@/lib/format";
import { gameStateLabel, survivorProvisionalOutcome } from "@/lib/game";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingRegion } from "@/components/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { PickOutcomeBadge } from "@/components/league/pick-outcome";
import { QueryState } from "@/components/query-state";
import { StatusPill } from "@/components/status-pill";
import { TeamLogo } from "@/components/team-logo";
import { UserIdentity } from "@/components/user-identity";

/**
 * The survivor board (spec §Standings View): every member's status, the week
 * they went out, the teams they have burned, and their week-by-week history.
 *
 * **One card per member, not a week-by-member grid.** An eighteen-week season
 * across a dozen members is a matrix no phone can render, and picks are made on
 * phones — so the season reads down the card and the history sits behind a
 * disclosure rather than across columns. This is why it isn't the shared
 * `Table`: not every list is one (engineering rules §Quality), and the same
 * reasoning already keeps the admin browsers on card-lists.
 *
 * There is no rank column and no total, because the mode has neither
 * (ADR-0016). The question this board answers is who is left.
 */

function statusLabel(member: SurvivorStandingsMember, winnerCount: number): string {
  if (member.isWinner) return winnerCount > 1 ? "Co-winner" : "Winner";
  return member.status === SURVIVOR_MEMBER_STATUS.ALIVE ? "Alive" : "Out";
}

/**
 * A pick's verdict for display: the settled grade, else the one derived from
 * its game's terminal state (FB-23's rule, reused board-wide by FB-25) — the
 * two can never disagree for a single pick.
 */
function gradeOf(pick: SurvivorStandingsPick): PickOutcome | null {
  if (pick.outcome) return pick.outcome;
  if (!pick.game || !pick.teamId) return null;
  return survivorProvisionalOutcome(
    {
      status: pick.game.status,
      homeScore: pick.game.homeScore,
      awayScore: pick.game.awayScore,
      homeTeam: { id: pick.game.homeTeamId },
      awayTeam: { id: pick.game.awayTeamId },
    },
    pick.teamId,
  );
}

/** `gameStateLabel`'s shape, built from the pick's game block + the shared team lookup. */
function gameStateInput(game: SurvivorStandingsPickGame, teams: ReadonlyMap<string, SlateTeam>) {
  return {
    status: game.status,
    kickoffAt: game.kickoffAt,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    period: game.period,
    clockSeconds: game.clockSeconds,
    homeTeam: { abbreviation: teams.get(game.homeTeamId)?.abbreviation ?? "—" },
    awayTeam: { abbreviation: teams.get(game.awayTeamId)?.abbreviation ?? "—" },
  };
}

function SurvivorBoardSkeleton() {
  return (
    <LoadingRegion label="Loading the survivor board" className="flex flex-col gap-3">
      {Array.from({ length: 4 }, (_unused, index) => (
        <Skeleton key={index} className="h-24 w-full" />
      ))}
    </LoadingRegion>
  );
}

export function SurvivorBoard({ leagueId }: { leagueId: string }) {
  const standings = useSurvivorStandings(leagueId);

  return (
    <Card data-testid="survivor-board">
      <CardHeader>
        <CardTitle>Survivor board</CardTitle>
        <CardDescription>
          {standings.data?.concluded
            ? "The season is over — everyone still standing shares first place."
            : "Who's still alive, the teams they've used, and every pick that has kicked off."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <QueryState
          isPending={standings.isPending}
          pendingFallback={<SurvivorBoardSkeleton />}
          isError={standings.isError}
          onRetry={() => standings.refetch()}
          errorMessage="Couldn't load the survivor board."
          isEmpty={standings.data?.weeks.length === 0}
          emptyMessage="This league's weeks haven't been scheduled yet."
        >
          {standings.data && <BoardRows board={standings.data} />}
        </QueryState>

        {/* The spec requires a "last updated" stamp and forbids claiming
            real-time freshness — never "live", just when settlement last wrote
            this board. `data-settled` is the fact the stamp reports, so a
            journey can assert either state without binding to a sentence. */}
        <p
          data-testid="survivor-board-updated-at"
          data-settled={standings.data?.updatedAt ? "true" : "false"}
          className="text-xs text-muted-foreground"
        >
          {standings.data?.updatedAt
            ? `Last updated ${formatDateTime(standings.data.updatedAt)}`
            : "Nothing has settled yet."}
        </p>
      </CardContent>
    </Card>
  );
}

function BoardRows({ board }: { board: SurvivorStandingsResponse }) {
  const teams = new Map(board.teams.map((team) => [team.id, team]));
  const weekLabels = new Map(board.weeks.map((week) => [week.weekId, week.label]));
  const weekOrder = new Map(board.weeks.map((week, index) => [week.weekId, index]));
  const winnerCount = board.members.filter((member) => member.isWinner).length;

  // Survivors first, then the eliminated in reverse order of going out — how far
  // someone got is the board's own subject, and the server's member order (the
  // roster's) buries the three people still in among nine who aren't.
  const eliminationOrder = (member: SurvivorStandingsMember) =>
    member.eliminatedWeekId === null ? -1 : (weekOrder.get(member.eliminatedWeekId) ?? -1);
  const rows = [...board.members].sort((a, b) => {
    const aliveA = a.status === SURVIVOR_MEMBER_STATUS.ALIVE;
    const aliveB = b.status === SURVIVOR_MEMBER_STATUS.ALIVE;
    if (aliveA !== aliveB) return aliveA ? -1 : 1;
    return eliminationOrder(b) - eliminationOrder(a);
  });

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((member) => (
        <BoardRow
          key={member.leagueMemberId}
          member={member}
          teams={teams}
          weekLabels={weekLabels}
          winnerCount={winnerCount}
          currentWeekId={board.currentWeekId}
          concluded={board.concluded}
        />
      ))}
    </ul>
  );
}

function BoardRow({
  member,
  teams,
  weekLabels,
  winnerCount,
  currentWeekId,
  concluded,
}: {
  member: SurvivorStandingsMember;
  teams: ReadonlyMap<string, SlateTeam>;
  weekLabels: ReadonlyMap<string, string>;
  winnerCount: number;
  currentWeekId: string | null;
  concluded: boolean;
}) {
  const alive = member.status === SURVIVOR_MEMBER_STATUS.ALIVE;
  const eliminatedIn = member.eliminatedWeekId ? weekLabels.get(member.eliminatedWeekId) : null;
  const currentPick = currentWeekId
    ? (member.picks.find((pick) => pick.weekId === currentWeekId) ?? null)
    : null;
  // Alive despite a pick that has provisionally lost (FB-27): the everyone-out
  // revival is still possible, and a bare "Alive" beside a lost pick reads as a
  // bug. Provisional only — once the week settles, the member is either Out or
  // carries the Revived pill; and the server ends this state at the right
  // moment on its own, since ADR-0028's provisional elimination flips them to
  // Out the instant someone else's survival is certain.
  const revivalPossible =
    alive &&
    !concluded &&
    currentPick !== null &&
    currentPick.outcome === null &&
    gradeOf(currentPick) === PICK_OUTCOME.INCORRECT;
  const showCurrentPick = !concluded && alive && currentPick !== null;

  return (
    <li
      // The row's identity and its two verdicts as data: the pills' words are
      // copy, and "Out" is not a value any journey should have to match on.
      data-testid="survivor-board-row"
      data-member={member.leagueMemberId}
      data-status={member.status}
      data-winner={member.isWinner ? "true" : "false"}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <UserIdentity
          displayName={member.displayName}
          username={member.username}
          image={member.image}
          isViewer={member.isViewer}
          avatarSize="sm"
        >
          {eliminatedIn && (
            <span
              // The week as data beside the sentence it is printed in: which
              // week ended a member's season is the board's own claim about
              // them, and the only place it appears.
              data-testid="survivor-eliminated-week"
              data-week={member.eliminatedWeekId}
              className="block truncate text-xs text-muted-foreground"
            >
              Out in {eliminatedIn}
            </span>
          )}
        </UserIdentity>
        <div className="flex shrink-0 items-center gap-1.5">
          {revivalPossible && (
            <StatusPill data-testid="survivor-revival-possible">Revival possible</StatusPill>
          )}
          {member.revivedCount > 0 && (
            <StatusPill tone="accent" data-testid="survivor-revived">
              Revived{member.revivedCount > 1 ? ` ×${member.revivedCount}` : ""}
            </StatusPill>
          )}
          <StatusPill
            tone={member.isWinner ? "success" : alive ? "highlight" : "neutral"}
            data-testid="survivor-member-status"
          >
            {statusLabel(member, winnerCount)}
          </StatusPill>
        </div>
      </div>

      {/* The current week at the row level (FB-26): what this member is riding
          right now is the board's most-asked question, and it shouldn't sit
          behind the history disclosure. Skipped once the season is over or the
          member is out — there is no "this week" left for them, and their last
          pick stays in the history instead. */}
      {showCurrentPick && currentPick !== null && (
        <CurrentWeekPick pick={currentPick} teams={teams} />
      )}

      <ConsumedTeams member={member} teams={teams} />
      <PickHistory
        member={member}
        teams={teams}
        weekLabels={weekLabels}
        // Excluded exactly when the row-level section rendered it — history is
        // "previous weeks" only where a current week is being shown (FB-26).
        excludeWeekId={showCurrentPick ? currentWeekId : null}
      />
    </li>
  );
}

/**
 * The member's current-week pick, live: team, game state, and the settled or
 * derived verdict. A pick that exists but is withheld renders as the fact that
 * it exists — the league sees they're in without seeing who they took (spec
 * §Pick Visibility; the server sent no team and no game for it).
 */
function CurrentWeekPick({
  pick,
  teams,
}: {
  pick: SurvivorStandingsPick;
  teams: ReadonlyMap<string, SlateTeam>;
}) {
  const now = useAppNow();
  const team = pick.teamId ? teams.get(pick.teamId) : null;
  const grade = gradeOf(pick);

  return (
    <div
      data-testid="survivor-current-pick"
      // The same identity attributes the history entries carry, so a journey
      // can address "this member's pick for week N" without caring which of
      // the two homes (row level vs history) the board gave it.
      data-week={pick.weekId}
      data-team={team?.abbreviation}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/40 p-2 text-xs"
    >
      <span className="font-medium text-muted-foreground">This week</span>
      {team ? (
        <>
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <TeamLogo logoLightUrl={team.logoLightUrl} logoDarkUrl={team.logoDarkUrl} size="sm" />
            {team.abbreviation}
          </span>
          {pick.game && (
            <span className="text-muted-foreground">
              {gameStateLabel(gameStateInput(pick.game, teams), now)}
            </span>
          )}
          {grade && <PickOutcomeBadge outcome={grade} />}
        </>
      ) : (
        <span className="text-muted-foreground">In — hidden until kickoff</span>
      )}
    </div>
  );
}

function ConsumedTeams({
  member,
  teams,
}: {
  member: SurvivorStandingsMember;
  teams: ReadonlyMap<string, SlateTeam>;
}) {
  if (member.consumedTeamIds.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {/* Phrased for what the caller actually knows: an empty list on someone
            else's row means nothing has been revealed, not that nothing was
            picked (spec §Pick Visibility). */}
        {member.isViewer ? "You haven't used any teams yet." : "No picks revealed yet."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">Teams used</p>
      <ul className="flex flex-wrap gap-1.5">
        {member.consumedTeamIds.map((teamId) => {
          const team = teams.get(teamId);
          return (
            <li key={teamId}>
              <StatusPill data-testid="survivor-consumed-team" data-team={team?.abbreviation}>
                {team && (
                  <TeamLogo
                    logoLightUrl={team.logoLightUrl}
                    logoDarkUrl={team.logoDarkUrl}
                    size="sm"
                    // Down to the pill's own type scale: the sm logo is sized
                    // for a button, and at that size here it sets the pill's
                    // height instead of sitting inside it.
                    className="size-4"
                  />
                )}
                <span title={team?.name}>{team?.abbreviation ?? "—"}</span>
              </StatusPill>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The member's season, behind a native disclosure: eighteen weeks open by
 * default would bury the twelve rows around it, and `details`/`summary` is
 * keyboard-operable and announced without any of the state a custom one needs.
 */
function PickHistory({
  member,
  teams,
  weekLabels,
  excludeWeekId,
}: {
  member: SurvivorStandingsMember;
  teams: ReadonlyMap<string, SlateTeam>;
  weekLabels: ReadonlyMap<string, string>;
  /** The week the row-level section already shows, or null to list everything. */
  excludeWeekId: string | null;
}) {
  const picks = member.picks.filter((pick) => pick.weekId !== excludeWeekId);
  if (picks.length === 0) return null;

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        Pick history ({picks.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {picks.map((pick) => {
          const team = pick.teamId ? teams.get(pick.teamId) : null;
          // Settled or derived (FB-25), same as everywhere else on the board.
          const grade = gradeOf(pick);
          return (
            <li
              key={pick.weekId}
              data-testid="survivor-history-entry"
              data-week={pick.weekId}
              data-team={team?.abbreviation}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-muted-foreground">{weekLabels.get(pick.weekId)}</span>
              <span className="flex items-center gap-1.5">
                {team && (
                  <TeamLogo
                    logoLightUrl={team.logoLightUrl}
                    logoDarkUrl={team.logoDarkUrl}
                    size="sm"
                  />
                )}
                <span className={team ? "font-medium text-foreground" : "text-muted-foreground"}>
                  {/* A pick whose game hasn't kicked off is present but nameless
                      — the league knows they're in, not who they took. */}
                  {team ? team.abbreviation : "Hidden until kickoff"}
                </span>
                {grade && <PickOutcomeBadge outcome={grade} />}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
