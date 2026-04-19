import { getLeagueById } from "@/data/leagues";
import { getLeagueMembersWithProfiles } from "@/data/members";
import {
  getLeagueSeasonPairsForEvent,
  getLeagueSeasonPairsWithUnscoredFinalPicks,
  getPicksForLeagueSeasonWithEvent,
  updatePickResults,
  type LeagueSeasonPair,
  type PickResultUpdate,
} from "@/data/picks";
import { upsertLeagueStanding } from "@/data/standings";
import { withTransaction } from "@/data/utils";
import type { PickResult } from "@/lib/db/schema/picks";
import {
  calculatePickResult,
  calculateStandingsPoints,
  denseRank,
} from "@/lib/nfl/scoring";

export interface StandingsRecalcResult {
  leaguesAffected: number;
  picksRescored: number;
}

export async function runStandingsRecalc(): Promise<StandingsRecalcResult> {
  const pairs = await getLeagueSeasonPairsWithUnscoredFinalPicks();
  return recalcPairs(pairs);
}

export async function runStandingsRecalcForEvent(
  eventId: string,
): Promise<StandingsRecalcResult> {
  const pairs = await getLeagueSeasonPairsForEvent(eventId);
  return recalcPairs(pairs);
}

async function recalcPairs(
  pairs: LeagueSeasonPair[],
): Promise<StandingsRecalcResult> {
  // Serial across pairs so a burst of finalized events doesn't open a
  // flurry of concurrent transactions. Each pair is already parallelized
  // internally across member upserts.
  let picksRescored = 0;
  for (const { leagueId, seasonId } of pairs) {
    picksRescored += await recalcLeagueSeason(leagueId, seasonId);
  }
  return { leaguesAffected: pairs.length, picksRescored };
}

async function recalcLeagueSeason(
  leagueId: string,
  seasonId: string,
): Promise<number> {
  const [league, seasonPicks, members] = await Promise.all([
    getLeagueById(leagueId),
    getPicksForLeagueSeasonWithEvent(leagueId, seasonId),
    getLeagueMembersWithProfiles(leagueId),
  ]);
  if (!league) return 0;

  // Re-score every pick in the (league, season). Scoring is deterministic
  // from the event's current state, so we always recompute — this is the
  // §8.5 step-4 "full integrity check" pass rather than an incremental
  // delta. Only persist rows whose stored pickResult differs from the
  // computed one (covers both "unscored → scored" and "admin edit changed
  // the result").
  const updates: PickResultUpdate[] = [];
  const resultsByUser = new Map<string, (PickResult | null)[]>();
  for (const member of members) {
    resultsByUser.set(member.userId, []);
  }
  for (const { pick, event } of seasonPicks) {
    const newResult = calculatePickResult(pick, event, league.pickType);
    if (newResult !== pick.pickResult) {
      updates.push({ id: pick.id, pickResult: newResult });
    }
    const bucket = resultsByUser.get(pick.userId);
    if (bucket) {
      bucket.push(newResult);
    } else {
      // Historical picks from a former member (removed mid-season) still
      // count toward §4.3 "historical picks and standings remain" — keep
      // them in the totals even though the user isn't in `members` now.
      resultsByUser.set(pick.userId, [newResult]);
    }
  }

  // Totals per user (lazy-init §8.6 zero rows for members without any
  // scored picks — guarantees everyone has a standing to rank).
  const totalsByUser = new Map(
    Array.from(resultsByUser, ([userId, results]) => [
      userId,
      calculateStandingsPoints(results),
    ]),
  );

  // Dense ranking by points (§8.4).
  const ranked = denseRank(
    Array.from(totalsByUser, ([userId, totals]) => ({
      userId,
      ...totals,
    })),
    (entry) => entry.points,
  );

  // Atomic per-pair write: pick result updates + standings upserts land
  // together so a partial failure doesn't leave standings out of sync
  // with the pick results that drove them.
  await withTransaction(async (tx) => {
    await updatePickResults(updates, tx);
    await Promise.all(
      ranked.map(({ entry, rank }) =>
        upsertLeagueStanding(
          {
            leagueId,
            userId: entry.userId,
            seasonId,
            wins: entry.wins,
            losses: entry.losses,
            pushes: entry.pushes,
            points: entry.points,
            rank,
          },
          tx,
        ),
      ),
    );
  });

  return updates.length;
}
