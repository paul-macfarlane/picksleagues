import { inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, leagueMembers, survivorPickResults, survivorState, weeks } from "@picksleagues/db";
import {
  GAME_STATUS,
  WEEK_TYPE,
  isUnplayedStatus,
  nflSeasonOrdinal,
  type SurvivorSettings,
  type WeekType,
} from "@picksleagues/schemas";
import { resolveGameOverrides } from "../games";

/**
 * **The one home for "is this Survivor season over, and who won it"** (spec
 * §End of League, ADR-0027). The board serializer, the pick endpoint and the
 * dashboard glance all ask it, and each of them acts on the answer — naming a
 * winner, refusing a write, telling a member they owe nothing — so three copies
 * of the rule would be three places for a league to be over on one screen and
 * running on another.
 *
 * A season ends at whichever comes first: every in-range week has played out, or
 * settlement has reduced the league to a single member still alive. The second
 * arm is self-securing — ending the season is what leaves nothing that could
 * unsettle it, since there is no later week, no later pick, and nothing further
 * to grade against the winner.
 *
 * Derived rather than read off `league_seasons.status`, which nothing in this
 * codebase writes: a status check would answer "active" for a season that
 * finished in January. Persisting conclusion is LG-12's, and this is what will
 * decide what it persists.
 */

/** What resolving a season's decided state needs, and all it needs. */
export interface SurvivorSeasonStateInput {
  leagueSeasonId: string;
  leagueId: string;
  seasonId: string;
  settings: SurvivorSettings;
}

export interface SurvivorSeasonState {
  /** Whether the season is over — by either arm of spec §End of League. */
  decided: boolean;
  /**
   * The members who won it, empty while it runs. Several at once is the
   * co-winner case rather than a tie to break (spec §End of League).
   */
  winnerMemberIds: ReadonlySet<string>;
}

const RUNNING: SurvivorSeasonState = { decided: false, winnerMemberIds: new Set() };

/**
 * Whether a league that plays `settings`' range plays this week. Survivor is
 * **regular-season only** (spec §Game Mode 2 — Core Rules), so the week type is
 * checked in its own right rather than left to the ordinal comparison: the
 * stored range can only ever name regular weeks, but stating the mode's rule
 * where it applies keeps it true if a stored range is ever widened.
 *
 * Exported because the settlement replay, the board's week frame and the
 * dashboard glance each clip a season to the same weeks, and a league whose
 * surfaces disagreed about which weeks it plays would grade one set and display
 * another.
 */
export function isSurvivorRangeWeek(
  week: { weekType: WeekType; weekNumber: number },
  settings: SurvivorSettings,
): boolean {
  if (week.weekType !== WEEK_TYPE.REGULAR) return false;
  const ordinal = nflSeasonOrdinal({ type: WEEK_TYPE.REGULAR, number: week.weekNumber });
  return (
    ordinal >= nflSeasonOrdinal(settings.startWeek) && ordinal <= nflSeasonOrdinal(settings.endWeek)
  );
}

export async function resolveSurvivorSeasonState(
  db: Db,
  input: SurvivorSeasonStateInput,
): Promise<SurvivorSeasonState> {
  const states = await resolveSurvivorSeasonStates(db, [input]);
  return states.get(input.leagueSeasonId) ?? RUNNING;
}

/**
 * Keyed by `leagueSeasonId`, with every input present. Batched because the
 * dashboard resolves every league a member is in on one request: a per-league
 * resolution would put this on that page's critical path N times, so the query
 * count here is constant whatever the count of leagues is.
 */
export async function resolveSurvivorSeasonStates(
  db: Db,
  inputs: readonly SurvivorSeasonStateInput[],
): Promise<Map<string, SurvivorSeasonState>> {
  const states = new Map<string, SurvivorSeasonState>();
  if (inputs.length === 0) return states;

  const leagueSeasonIds = inputs.map((input) => input.leagueSeasonId);
  const leagueIds = [...new Set(inputs.map((input) => input.leagueId))];

  const memberRows = await db
    .select({ id: leagueMembers.id, leagueId: leagueMembers.leagueId })
    .from(leagueMembers)
    .where(inArray(leagueMembers.leagueId, leagueIds));
  const membersByLeague = new Map<string, string[]>();
  for (const row of memberRows) {
    const bucket = membersByLeague.get(row.leagueId);
    if (bucket) bucket.push(row.id);
    else membersByLeague.set(row.leagueId, [row.id]);
  }

  const stateRows = await db
    .select({
      leagueSeasonId: survivorState.leagueSeasonId,
      leagueMemberId: survivorState.leagueMemberId,
      eliminatedWeekId: survivorState.eliminatedWeekId,
    })
    .from(survivorState)
    .where(inArray(survivorState.leagueSeasonId, leagueSeasonIds));
  // Absence of a row means alive — nothing mints one at join time, the ledger is
  // settlement's output alone (ADR-0025), so this is a left join by hand.
  const eliminatedBySeason = new Map<string, Set<string>>();
  for (const row of stateRows) {
    if (row.eliminatedWeekId === null) continue;
    const bucket = eliminatedBySeason.get(row.leagueSeasonId);
    if (bucket) bucket.add(row.leagueMemberId);
    else eliminatedBySeason.set(row.leagueSeasonId, new Set([row.leagueMemberId]));
  }

  // "Settlement has written this season" — the guard on the range arm below,
  // which must not crown a winner off game statuses the grader hasn't graded.
  // Both tables count and neither alone suffices: a week everyone survived
  // writes results and no state, and a member eliminated for missing every week
  // writes state and no results.
  const gradedSeasonIds = new Set(
    (
      await db
        .selectDistinct({ leagueSeasonId: survivorPickResults.leagueSeasonId })
        .from(survivorPickResults)
        .where(inArray(survivorPickResults.leagueSeasonId, leagueSeasonIds))
    ).map((row) => row.leagueSeasonId),
  );
  const settledSeasonIds = new Set([
    ...gradedSeasonIds,
    ...stateRows.map((row) => row.leagueSeasonId),
  ]);

  const pending: Array<{ input: SurvivorSeasonStateInput; alive: string[] }> = [];
  for (const input of inputs) {
    const eliminated = eliminatedBySeason.get(input.leagueSeasonId);
    const alive = (membersByLeague.get(input.leagueId) ?? []).filter(
      (memberId) => !eliminated?.has(memberId),
    );

    // The sole-survivor arm (ADR-0027). It turns on the league having been
    // *reduced* to one: a member alone in a league nobody joined has won
    // nothing, and telling them so would end their season before its first
    // kickoff.
    if (eliminated !== undefined && eliminated.size > 0 && alive.length === 1) {
      states.set(input.leagueSeasonId, { decided: true, winnerMemberIds: new Set(alive) });
      continue;
    }

    if (!settledSeasonIds.has(input.leagueSeasonId)) {
      states.set(input.leagueSeasonId, RUNNING);
      continue;
    }
    pending.push({ input, alive });
  }

  if (pending.length === 0) return states;

  const weeksByPending = await loadInRangeWeekIds(
    db,
    pending.map(({ input }) => input),
  );
  const gamesByWeek = await loadGamesByWeek(db, [...new Set([...weeksByPending.values()].flat())]);

  for (const { input, alive } of pending) {
    const weekIds = weeksByPending.get(input.leagueSeasonId) ?? [];
    const playedOut = rangePlayedOut(weekIds, gamesByWeek);
    states.set(
      input.leagueSeasonId,
      playedOut ? { decided: true, winnerMemberIds: new Set(alive) } : RUNNING,
    );
  }

  return states;
}

/** The in-range week ids of each input, keyed by `leagueSeasonId`. */
async function loadInRangeWeekIds(
  db: Db,
  inputs: readonly SurvivorSeasonStateInput[],
): Promise<Map<string, string[]>> {
  const seasonIds = [...new Set(inputs.map((input) => input.seasonId))];
  const rows = await db
    .select({
      id: weeks.id,
      seasonId: weeks.seasonId,
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
    })
    .from(weeks)
    .where(inArray(weeks.seasonId, seasonIds));

  const bySeason = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = bySeason.get(row.seasonId);
    if (bucket) bucket.push(row);
    else bySeason.set(row.seasonId, [row]);
  }

  // Clipped per league rather than per season: two leagues can share a season
  // and resolve different ranges over it (ADR-0024).
  return new Map(
    inputs.map((input) => [
      input.leagueSeasonId,
      (bySeason.get(input.seasonId) ?? [])
        .filter((row) => isSurvivorRangeWeek(row, input.settings))
        .map((row) => row.id),
    ]),
  );
}

type EffectiveGame = ReturnType<typeof resolveGameOverrides>;

async function loadGamesByWeek(
  db: Db,
  weekIds: readonly string[],
): Promise<Map<string, EffectiveGame[]>> {
  const byWeek = new Map<string, EffectiveGame[]>(weekIds.map((weekId) => [weekId, []]));
  if (weekIds.length === 0) return byWeek;

  const rows = await db
    .select()
    .from(games)
    .where(inArray(games.weekId, [...weekIds]));
  for (const row of rows) {
    byWeek.get(row.weekId)?.push(resolveGameOverrides(row));
  }
  return byWeek;
}

/**
 * Whether every week the league plays has finished — the spec's original ending,
 * and the one a season that never loses a member reaches.
 *
 * **This restates settlement's completeness rule rather than reading its output,
 * and the two must not drift.** The sibling copy is the week loop in
 * `settlement.ts`; change one and this answers a different question than the
 * grader did, which here means crowning a winner mid-season or never crowning
 * one at all. The duplication exists because settlement stores no "settled
 * through week N" marker, and results coverage cannot stand in for one — a week
 * nobody alive picked, and an eliminated member's ungraded pick, both
 * legitimately produce no result row. A stored marker is the right fix if this
 * ever needs a third caller.
 */
function rangePlayedOut(
  weekIds: readonly string[],
  gamesByWeek: ReadonlyMap<string, EffectiveGame[]>,
): boolean {
  if (weekIds.length === 0) return false;

  return weekIds.every((weekId) => {
    const weekGames = gamesByWeek.get(weekId) ?? [];
    // A week with no games is not a week that finished, it is a week the
    // schedule never filled — and it blocks the replay for the same reason.
    if (weekGames.length === 0) return false;
    return weekGames.every((game) => {
      // `isUnplayedStatus` is cancelled and nothing else — a game that will
      // never be played in this week, which the spec resolves as a push. It
      // reads like the opposite of what it gates, so: cancelled counts as done,
      // scheduled and in-progress and postponed do not.
      if (isUnplayedStatus(game.status)) return true;
      return (
        game.status === GAME_STATUS.FINAL && game.homeScore !== null && game.awayScore !== null
      );
    });
  });
}
