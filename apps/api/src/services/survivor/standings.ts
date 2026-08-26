import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import {
  games,
  survivorPickResults,
  survivorPicks,
  survivorState,
  teams,
  weeks,
} from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  SURVIVOR_MEMBER_STATUS,
  WEEK_TYPE,
  nflSeasonOrdinal,
  type SlateTeam,
  type SurvivorSettings,
  type SurvivorStandingsMember,
  type SurvivorStandingsPick,
  type SurvivorStandingsResponse,
} from "@picksleagues/schemas";
import { resolveGameOverrides } from "../games";
import { teamDisplayColumns } from "../teams";
import { resolveCurrentWeekId } from "../league-weeks";
// Deep import by design: `serialize` is module-public so sibling domains can
// cross-import it without going through the leagues barrel (see leagues/index.ts).
import { loadMembers } from "../leagues/serialize";
import { isLocked } from "../slate";
import { resolveUserImage } from "../users";
import { loadContext, type SurvivorLeagueRefusal, type SurvivorResult } from "./picks";
import { isSurvivorRangeWeek, resolveSurvivorSeasonState } from "./season";

/**
 * The survivor board (spec §Standings View): every member with their status,
 * the week they went out, their weekly pick history, and the teams they have
 * burned. Read-only — everything it reports is settlement's output (arch D10),
 * so a stale board means settlement hasn't run, which is what `updatedAt` tells
 * the viewer.
 *
 * There is no ranking and no points here, and that is the mode (ADR-0016):
 * Survivor grades survive-or-eliminate, so the board answers "who is left"
 * rather than "who is ahead".
 *
 * The two visibility rules the query layer owns, both enforced below and never
 * left to a client (arch §Locking Model):
 * - a member's pick for a week reaches the rest of the league only once that
 *   pick's own game has kicked off — the same `isLocked`-on-effective-kickoff
 *   rule the week read path applies (arch D11), computed here from the one
 *   game read the pick's state block also serializes from;
 * - **another member's consumed-team list is built from their revealed picks
 *   alone.** This is the board's one subtle leak vector: a member's current-week
 *   pick is withheld above, and listing its team here would disclose exactly
 *   what that withholding protected.
 */

export type SurvivorStandingsResult = SurvivorResult<
  SurvivorStandingsResponse,
  SurvivorLeagueRefusal
>;

/** An in-range week and its place in the season, which is the board's column order. */
interface InRangeWeek {
  id: string;
  label: string;
  ordinal: number;
  startsAt: Date;
  endsAt: Date;
}

/**
 * The weeks this league plays, in season order. Ordered by the season ordinal
 * rather than by `starts_at` because the ordinal is the order settlement
 * replays in (ADR-0025) and two weeks can share a start instant. Survivor is
 * regular-season only (spec §Game Mode 2 — Core Rules), so a postseason week is
 * never in range whatever the stored settings say.
 */
async function loadInRangeWeeks(
  db: Db,
  seasonId: string,
  settings: SurvivorSettings,
): Promise<InRangeWeek[]> {
  const rows = await db
    .select({
      id: weeks.id,
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
      label: weeks.label,
      startsAt: weeks.startsAt,
      endsAt: weeks.endsAt,
    })
    .from(weeks)
    .where(eq(weeks.seasonId, seasonId));

  return rows
    .flatMap((row) => {
      if (!isSurvivorRangeWeek(row, settings)) return [];
      const ordinal = nflSeasonOrdinal({ type: WEEK_TYPE.REGULAR, number: row.weekNumber });
      return [
        { id: row.id, label: row.label, ordinal, startsAt: row.startsAt, endsAt: row.endsAt },
      ];
    })
    .sort((a, b) => a.ordinal - b.ordinal);
}

export async function getSurvivorStandings(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
): Promise<SurvivorStandingsResult> {
  const context = await loadContext(db, leagueId, userId);
  if (!context.ok) return context;
  const { leagueSeasonId, seasonId, settings, status } = context.value;

  const inRangeWeeks = await loadInRangeWeeks(db, seasonId, settings);
  const weekIds = inRangeWeeks.map((week) => week.id);
  const weekOrdinals = new Map(inRangeWeeks.map((week) => [week.id, week.ordinal]));

  // Shared with the week's pick read so the two surfaces can't disagree about
  // member order, which is user-visible in both.
  const members = await loadMembers(db, leagueId);

  const picks =
    weekIds.length === 0
      ? []
      : await db
          .select()
          .from(survivorPicks)
          .where(
            and(
              eq(survivorPicks.leagueSeasonId, leagueSeasonId),
              inArray(survivorPicks.weekId, weekIds),
            ),
          );

  // The game rows behind the picks — one read serving both the reveal gate and
  // the state block each revealed pick carries (FB-25). Locks derive from the
  // same rows rather than a second `resolveLockStates` query: two reads of the
  // same table leave a window where a kickoff override lands between them and
  // the gate and the block disagree about the same game.
  const gameRows =
    picks.length === 0
      ? []
      : await db
          .select()
          .from(games)
          .where(inArray(games.id, [...new Set(picks.map((pick) => pick.gameId))]));
  const gamesById = new Map(gameRows.map((row) => [row.id, row]));
  const now = clock.now();
  const lockedByGame = new Map(
    gameRows.map((row) => [row.id, isLocked(resolveGameOverrides(row).kickoffAt, now)]),
  );

  const results = await db
    .select()
    .from(survivorPickResults)
    .where(eq(survivorPickResults.leagueSeasonId, leagueSeasonId));
  const outcomeByPickId = new Map(results.map((row) => [row.survivorPickId, row.outcome]));

  const state = await db
    .select()
    .from(survivorState)
    .where(eq(survivorState.leagueSeasonId, leagueSeasonId));
  const stateByMemberId = new Map(state.map((row) => [row.leagueMemberId, row]));

  // Taken from the rows already selected rather than a second `max()` query: a
  // settlement landing between two statements would stamp the response with an
  // instant newer than the state it returns, which is the false freshness claim
  // this field exists to prevent. Both tables count — a season where nobody has
  // been graded yet can still have had members eliminated for missing a week.
  const stamps = [...results.map((row) => row.settledAt), ...state.map((row) => row.updatedAt)];
  const updatedAt =
    stamps.length === 0 ? null : new Date(Math.max(...stamps.map((at) => at.getTime())));

  // Both endings the spec names, answered in one place (ADR-0027): the range
  // playing out, and the league being reduced to a single member — after which
  // no further week is played, so waiting for the range would withhold a result
  // nothing left to come can change.
  const season = await resolveSurvivorSeasonState(db, { leagueSeasonId, leagueId, status });

  const picksByMemberId = new Map<string, Array<typeof survivorPicks.$inferSelect>>();
  for (const pick of picks) {
    const bucket = picksByMemberId.get(pick.leagueMemberId);
    if (bucket) bucket.push(pick);
    else picksByMemberId.set(pick.leagueMemberId, [pick]);
  }

  const disclosedTeamIds = new Set<string>();

  const serialized: SurvivorStandingsMember[] = members.map(({ member, user }) => {
    const isViewer = member.userId === userId;
    const own = [...(picksByMemberId.get(member.id) ?? [])].sort(
      (a, b) => (weekOrdinals.get(a.weekId) ?? 0) - (weekOrdinals.get(b.weekId) ?? 0),
    );
    // The visibility rule itself (spec §Pick Visibility), resolved once per pick
    // because both the history entry and the consumed list below turn on it.
    const revealed = new Map(
      own.map((pick) => [pick.id, isViewer || lockedByGame.get(pick.gameId) === true]),
    );

    // Serialized newest week first (owner, 2026-08-14): the history is purely
    // retrospective — the current week's pick renders at row level, not here —
    // and mid-season the entries a member opens it for are the recent ones.
    // The matchup sheet's game logs and "Last 5" follow the same
    // most-recent-first rule; `own` itself stays in season order because the
    // consumed-team ledger below lists teams in the order they were burned.
    const history: SurvivorStandingsPick[] = own
      .map((pick) => {
        const visible = revealed.get(pick.id) === true;
        const gameRow = visible ? gamesById.get(pick.gameId) : undefined;
        const game = gameRow ? resolveGameOverrides(gameRow) : null;
        if (visible) {
          disclosedTeamIds.add(pick.teamId);
          // Both sides of a revealed pick's game, so the shared lookup can label
          // its score — the opponent may appear nowhere else in the response. A
          // withheld pick discloses neither (its game alone narrows the hidden
          // pick to two teams).
          if (gameRow) {
            disclosedTeamIds.add(gameRow.homeTeamId);
            disclosedTeamIds.add(gameRow.awayTeamId);
          }
        }
        return {
          weekId: pick.weekId,
          teamId: visible ? pick.teamId : null,
          outcome: visible ? (outcomeByPickId.get(pick.id) ?? null) : null,
          game:
            game && gameRow
              ? {
                  status: game.status,
                  kickoffAt: game.kickoffAt.toISOString(),
                  homeTeamId: gameRow.homeTeamId,
                  awayTeamId: gameRow.awayTeamId,
                  homeScore: game.homeScore,
                  awayScore: game.awayScore,
                  period: game.period,
                  clockSeconds: game.clockSeconds,
                }
              : null,
        };
      })
      .reverse();

    // A released pick is one a cancellation handed the team back for (spec
    // §Game Mode 2 — Cancelled game), so it never counts against the ledger.
    const consumedTeamIds = [
      ...new Set(
        own
          .filter((pick) => !pick.released && revealed.get(pick.id) === true)
          .map((pick) => pick.teamId),
      ),
    ];
    for (const teamId of consumedTeamIds) disclosedTeamIds.add(teamId);

    const eliminatedWeekId = stateByMemberId.get(member.id)?.eliminatedWeekId ?? null;
    const status =
      eliminatedWeekId === null ? SURVIVOR_MEMBER_STATUS.ALIVE : SURVIVOR_MEMBER_STATUS.ELIMINATED;

    return {
      leagueMemberId: member.id,
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      image: resolveUserImage(user),
      isViewer,
      status,
      eliminatedWeekId,
      revivedCount: stateByMemberId.get(member.id)?.revivedCount ?? 0,
      // Several at once is the co-winner case the spec names, not a bug (spec
      // §End of League) — there is no further tiebreaker to separate them.
      isWinner: season.winnerMemberIds.has(member.id),
      picks: history,
      consumedTeamIds,
    };
  });

  return {
    ok: true,
    value: {
      weeks: inRangeWeeks.map((week) => ({ weekId: week.id, label: week.label })),
      // The one current-week definition (league-weeks.ts), so the board's
      // row-level "this week" (FB-26) is the same week every other surface
      // calls current. Rows arrive ordinal-sorted, which is the season order
      // the positional fallback expects.
      currentWeekId: resolveCurrentWeekId(inRangeWeeks, clock),
      members: serialized,
      teams: await loadTeams(db, [...disclosedTeamIds]),
      concluded: season.decided,
      updatedAt: updatedAt?.toISOString() ?? null,
    },
  };
}

/**
 * The display data for the teams the response already named — nothing else. A
 * team the visibility rules withheld must not arrive here either: a lookup
 * carrying a team no member's history mentions is the same disclosure wearing a
 * different field name.
 */
async function loadTeams(db: Db, teamIds: readonly string[]): Promise<SlateTeam[]> {
  if (teamIds.length === 0) return [];
  return db
    .select(teamDisplayColumns(teams))
    .from(teams)
    .where(inArray(teams.id, [...teamIds]))
    .orderBy(asc(teams.abbreviation));
}
