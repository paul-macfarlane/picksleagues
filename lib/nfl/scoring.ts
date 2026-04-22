import type { PickType } from "@/lib/db/schema/leagues";
import type { PickResult } from "@/lib/db/schema/picks";
import type { Event } from "@/lib/db/schema/sports";

export const POINTS_PER_WIN = 1;
export const POINTS_PER_PUSH = 0.5;
export const POINTS_PER_LOSS = 0;

/**
 * BUSINESS_SPEC §8.2 points are always `wins + 0.5 × pushes`, so values
 * are either integer or ending in `.5`. Render whole numbers without a
 * trailing decimal so the leaderboard doesn't read as "5.0" next to
 * "4.5".
 */
export function formatPoints(points: number): string {
  if (Number.isInteger(points)) return points.toString();
  return points.toFixed(1);
}

/**
 * BUSINESS_SPEC §8.1.
 *
 * Returns null when the event isn't final or doesn't have both scores yet —
 * callers treat null as "not yet scored." Once status is `final` and both
 * scores exist, the result is deterministic from the event + the pick's
 * frozen spread.
 */
export function calculatePickResult(
  pick: { teamId: string; spreadAtLock: number | null },
  event: Pick<
    Event,
    "status" | "homeTeamId" | "awayTeamId" | "homeScore" | "awayScore"
  >,
  pickType: PickType,
): PickResult | null {
  if (event.status !== "final") return null;
  if (event.homeScore == null || event.awayScore == null) return null;

  const pickedHome = pick.teamId === event.homeTeamId;
  const pickedAway = pick.teamId === event.awayTeamId;
  if (!pickedHome && !pickedAway) return null;

  const pickedScore = pickedHome ? event.homeScore : event.awayScore;
  const opponentScore = pickedHome ? event.awayScore : event.homeScore;

  if (pickType === "straight_up") {
    if (pickedScore > opponentScore) return "win";
    if (pickedScore < opponentScore) return "loss";
    return "push";
  }

  // ATS: the frozen spread is applied to the picked team's score.
  // A null spread on an ATS league means we never captured a line — the
  // pick can't be scored, so return null and let the caller re-score once
  // odds populate (typically not reachable since the submission action
  // rejects picks without a spread, but defensive).
  if (pick.spreadAtLock == null) return null;
  const adjustedPickedScore = pickedScore + pick.spreadAtLock;
  if (adjustedPickedScore > opponentScore) return "win";
  if (adjustedPickedScore < opponentScore) return "loss";
  return "push";
}

export interface StandingTotals {
  wins: number;
  losses: number;
  pushes: number;
  points: number;
}

/**
 * BUSINESS_SPEC §8.2 — points = wins + (pushes × 0.5). Unresolved picks
 * (null pickResult) contribute nothing.
 */
export function calculateStandingsPoints(
  results: readonly (PickResult | null)[],
): StandingTotals {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  for (const result of results) {
    if (result === "win") wins++;
    else if (result === "loss") losses++;
    else if (result === "push") pushes++;
  }
  const points = wins * POINTS_PER_WIN + pushes * POINTS_PER_PUSH;
  return { wins, losses, pushes, points };
}

export interface WeeklyStanding {
  userId: string;
  wins: number;
  losses: number;
  pushes: number;
  points: number;
  rank: number;
}

/**
 * Per-phase standings for the given league members. Picks whose owner
 * isn't in `userIds` are ignored (former-member picks are preserved in
 * the DB per §4.3 but don't contribute to current standings). Members
 * with no picks this phase appear with a zero row so ranks are consistent
 * across everyone who should be compared.
 */
export function calculateWeeklyStandings(
  picks: readonly { userId: string; pickResult: PickResult | null }[],
  userIds: readonly string[],
): WeeklyStanding[] {
  const resultsByUser = new Map<string, (PickResult | null)[]>();
  for (const id of userIds) resultsByUser.set(id, []);
  for (const pick of picks) {
    const bucket = resultsByUser.get(pick.userId);
    if (bucket) bucket.push(pick.pickResult);
  }
  const rows = Array.from(resultsByUser.entries()).map(([userId, results]) => ({
    userId,
    ...calculateStandingsPoints(results),
  }));
  return denseRank(rows, (r) => r.points).map(({ entry, rank }) => ({
    ...entry,
    rank,
  }));
}

export interface StandingsDelta {
  priorRank: number;
  /** priorRank - currentRank: positive = moved up, negative = down, 0 = flat. */
  delta: number;
}

/**
 * Phase-over-phase rank delta for the current standings vs. the state at
 * the end of the previous phase. "Previous phase" = the phase immediately
 * before the latest phase that has at least one scored pick, ordered by
 * `phaseOrdinal` (lib/nfl/leagues). Returns an empty map when fewer than
 * two phases have any scored picks (nothing to compare against yet).
 *
 * Prior ranks are recomputed from scratch via the same §8.4 dense-rank
 * pipeline the recalc job uses, so the delta always reflects the current
 * state of stored pick results — admin edits that clear results via
 * PL-015 flow through without an extra invalidation path.
 */
export function calculatePhaseOverPhaseDeltas(
  currentStandings: readonly { userId: string; rank: number }[],
  picks: readonly {
    userId: string;
    phaseId: string;
    pickResult: PickResult | null;
  }[],
  phaseOrdinalById: ReadonlyMap<string, number>,
): Map<string, StandingsDelta> {
  const deltas = new Map<string, StandingsDelta>();
  const scoredOrdinals = new Set<number>();
  for (const pick of picks) {
    if (pick.pickResult === null) continue;
    const ordinal = phaseOrdinalById.get(pick.phaseId);
    if (ordinal === undefined) continue;
    scoredOrdinals.add(ordinal);
  }
  if (scoredOrdinals.size < 2) return deltas;

  const cutoff = Math.max(...scoredOrdinals);

  const priorResultsByUser = new Map<string, (PickResult | null)[]>();
  for (const { userId } of currentStandings) priorResultsByUser.set(userId, []);
  for (const pick of picks) {
    if (pick.pickResult === null) continue;
    const ordinal = phaseOrdinalById.get(pick.phaseId);
    if (ordinal === undefined) continue;
    if (ordinal >= cutoff) continue;
    const bucket = priorResultsByUser.get(pick.userId);
    if (bucket) bucket.push(pick.pickResult);
  }

  const priorTotals = Array.from(priorResultsByUser, ([userId, results]) => ({
    userId,
    ...calculateStandingsPoints(results),
  }));
  const priorRanks = new Map<string, number>();
  for (const { entry, rank } of denseRank(priorTotals, (t) => t.points)) {
    priorRanks.set(entry.userId, rank);
  }

  for (const { userId, rank: currentRank } of currentStandings) {
    // Every currentStandings user seeded priorResultsByUser above, so they
    // all produce a prior rank — ! is sound.
    const priorRank = priorRanks.get(userId)!;
    deltas.set(userId, { priorRank, delta: priorRank - currentRank });
  }
  return deltas;
}

export interface RankedEntry<T> {
  entry: T;
  rank: number;
}

/**
 * BUSINESS_SPEC §8.4 — dense ranking: tied entries share a rank; the
 * next distinct rank after a tie is `previousRank + tiedCount`. Entries
 * with equal `points` are considered tied.
 *
 * The input is not mutated; the result is sorted points-desc.
 */
export function denseRank<T>(
  entries: T[],
  getPoints: (entry: T) => number,
): RankedEntry<T>[] {
  const sorted = [...entries].sort((a, b) => getPoints(b) - getPoints(a));
  const ranked: RankedEntry<T>[] = [];
  let currentRank = 1;
  let previousPoints: number | null = null;
  let tiedCount = 0;
  for (const entry of sorted) {
    const points = getPoints(entry);
    if (previousPoints === null || points < previousPoints) {
      if (previousPoints !== null) {
        currentRank += tiedCount;
      }
      tiedCount = 1;
      previousPoints = points;
    } else {
      tiedCount++;
    }
    ranked.push({ entry, rank: currentRank });
  }
  return ranked;
}
