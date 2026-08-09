import { inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { leagueMembers, survivorState } from "@picksleagues/db";
import {
  isWeekInSeasonRange,
  LEAGUE_STATUS,
  WEEK_TYPE,
  type LeagueStatus,
  type SurvivorSettings,
  type WeekType,
} from "@picksleagues/schemas";

/**
 * **The one home for "is this Survivor season over, and who won it"** (spec
 * §End of League, ADR-0027). The board serializer, the pick endpoint and the
 * dashboard glance all ask it, and each of them acts on the answer — naming a
 * winner, refusing a write, telling a member they owe nothing — so three copies
 * of the rule would be three places for a league to be over on one screen and
 * running on another.
 *
 * A season ends at whichever comes first: every in-range week has played out, or
 * settlement has reduced the league to a single member still alive.
 *
 * **The stored status answers this, except in the one case where it cannot.**
 * Settlement writes `league_seasons.status` when it has finished grading
 * (ADR-0030), and reading that is what retired the old `rangePlayedOut` — a
 * second walk of the game rows restating settlement's completeness rule, which
 * could name a different week as the season's last than the grader did.
 *
 * The exception is the reduction that becomes certain *inside* an ungradeable
 * week (ADR-0028). Settlement deliberately does not write `concluded` there,
 * because that week still has to be graded and a retired season leaves the
 * nightly sweep — so the board derives that arm here, from the `survivor_state`
 * the provisional pass just wrote. It is the cheap half of the old derivation
 * and not the duplicated half: a count over the alive set, not a re-reading of
 * whether the schedule has finished.
 *
 * Either way *who won* is the same fact — the alive set — which no status can
 * carry and which is therefore always computed here.
 */

/** What resolving a season's decided state needs, and all it needs. */
export interface SurvivorSeasonStateInput {
  leagueSeasonId: string;
  leagueId: string;
  /**
   * Settlement's stored ending. Taken from the caller rather than re-queried
   * because every caller has already read the league's current instance to get
   * here, and a second read could disagree with the one their other fields came
   * from.
   */
  status: LeagueStatus;
}

export interface SurvivorSeasonState {
  /** Whether the season is over — by either arm of spec §End of League. */
  decided: boolean;
  /**
   * The members who won it, empty while it runs — always its alive set, by
   * either arm above. Several at once is the co-winner case rather than a tie
   * to break (spec §End of League).
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
  return isWeekInSeasonRange(week, settings);
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

  for (const input of inputs) {
    const eliminated = eliminatedBySeason.get(input.leagueSeasonId);
    const alive = (membersByLeague.get(input.leagueId) ?? []).filter(
      (memberId) => !eliminated?.has(memberId),
    );

    // The reduction arm, for the window where settlement knows the answer but
    // has not retired the season (see the module header). It turns on the league
    // having been *reduced* to one: a member alone in a league nobody joined has
    // won nothing, and telling them so would end their season before its first
    // kickoff.
    const reducedToOne = eliminated !== undefined && eliminated.size > 0 && alive.length === 1;

    states.set(
      input.leagueSeasonId,
      input.status === LEAGUE_STATUS.CONCLUDED || reducedToOne
        ? { decided: true, winnerMemberIds: new Set(alive) }
        : RUNNING,
    );
  }

  return states;
}
