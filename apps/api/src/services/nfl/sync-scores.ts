import { and, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons, weeks } from "@picksleagues/db";
import { type Clock, type GameDataProvider, nflSeasonYearFor } from "@picksleagues/core";
import {
  GAME_STATUS,
  JOB_SKIP_REASON,
  SPORT,
  WEEK_TYPE,
  type WeekType,
} from "@picksleagues/schemas";
import { logInfo } from "../../lib/logger";
import { resolveRecurringSyncSeasonYear } from "./season-lifecycle";
import { settlePicksForGames } from "../settlement";

/** A refresh target: one provider week fetch mapped to our week row. */
type ScoreTarget = {
  weekId: string;
  seasonYear: number;
  weekType: WeekType;
  weekNumber: number;
};

// Statuses whose games are still worth polling for score/status changes; a
// game past kickoff in one of these has an outcome the provider may have moved.
const ACTIVE_STATUSES = [GAME_STATUS.SCHEDULED, GAME_STATUS.IN_PROGRESS];

/**
 * Refreshes live scores/statuses for in-flight games from the provider into
 * our tables (arch §External Data — request paths never call the provider;
 * jobs sync, reads serve our tables). Runs every 5 minutes around the clock,
 * so the fast no-op path leads: when nothing has kicked off there are zero
 * provider calls and the job returns in milliseconds (arch §Background Jobs).
 *
 * Idempotent (engineering rules §Jobs): re-running with identical provider data
 * changes nothing (`gamesUpdated: 0`), so a missed or double-fired tick is
 * harmless.
 */
export async function syncNflScores(
  db: Db,
  clock: Clock,
  provider: GameDataProvider,
  opts?: { seasonYear?: number; weekType?: WeekType; weekNumber?: number },
): Promise<Record<string, string | number | boolean>> {
  // One `now` per run, bound into SQL as a parameter (arch D13) — never SQL now().
  const now = clock.now();
  // A week takes the explicit "refresh this week now" path (season is derived
  // when omitted, matching sync-schedule/sync-odds). Season alone stays on the
  // active-games gate — it only re-labels the season the gate's own join already
  // resolves, so there's nothing to short-circuit.
  const explicit = opts?.weekNumber !== undefined;

  let targets: ScoreTarget[];
  let activeGames = 0;

  if (explicit) {
    // An explicit admin/simulator trigger means "refresh this week now" — skip
    // the active-games gate and resolve the requested week from our tables. A
    // bare week number defaults to REGULAR; postseason must name `weekType`.
    // Season resolution lives inside this branch: the gate path below derives
    // every target's season from its own join, and the offseason roll-forward
    // query would otherwise cost the 5-minute no-op path an extra round trip.
    const seasonYear =
      opts?.seasonYear ?? (await resolveRecurringSyncSeasonYear(db, nflSeasonYearFor(now), now));
    const weekNumber = opts!.weekNumber!;
    const weekType = opts?.weekType ?? WEEK_TYPE.REGULAR;
    const [week] = await db
      .select({ weekId: weeks.id, weekType: weeks.weekType, weekNumber: weeks.weekNumber })
      .from(weeks)
      .innerJoin(sportSeasons, eq(weeks.seasonId, sportSeasons.id))
      .where(
        and(
          eq(sportSeasons.sport, SPORT.NFL),
          eq(sportSeasons.year, seasonYear),
          eq(weeks.weekType, weekType),
          eq(weeks.weekNumber, weekNumber),
        ),
      );
    if (!week) {
      // Sync jobs never create reference data — schedule-sync owns season/week
      // creation (feedback: recurring syncs query reference data, don't upsert).
      return { skipped: true, reason: JOB_SKIP_REASON.WEEK_NOT_SYNCED };
    }
    targets = [{ weekId: week.weekId, seasonYear, weekType: week.weekType, weekNumber }];
  } else {
    // Fast no-op path: one indexed query (games_status_kickoff_idx) — any game
    // that has kicked off and is not yet resolved.
    const activeRows = await db
      .select({ weekId: games.weekId })
      .from(games)
      .where(and(inArray(games.status, ACTIVE_STATUSES), lte(games.kickoffAt, now)));
    activeGames = activeRows.length;
    if (activeGames === 0) {
      return { skipped: true, reason: JOB_SKIP_REASON.NO_ACTIVE_GAMES, activeGames: 0 };
    }

    // Distinct weeks of the active games → the (season, type, week) triples to
    // refresh (regular and postseason week numbers overlap, so type is part of
    // the identity).
    const distinctWeekIds = [...new Set(activeRows.map((row) => row.weekId))];
    const weekRows = await db
      .select({
        weekId: weeks.id,
        seasonYear: sportSeasons.year,
        weekType: weeks.weekType,
        weekNumber: weeks.weekNumber,
      })
      .from(weeks)
      .innerJoin(sportSeasons, eq(weeks.seasonId, sportSeasons.id))
      .where(inArray(weeks.id, distinctWeekIds));
    targets = weekRows;
  }

  // Network I/O outside any transaction (engineering rules: never hold a
  // transaction open across a network call).
  const fetched = await Promise.all(
    targets.map((target) =>
      provider.fetchNflWeekGames(target.seasonYear, target.weekType, target.weekNumber),
    ),
  );
  const providerGamesById = new Map(fetched.flat().map((game) => [game.providerGameId, game]));

  const weekIds = targets.map((target) => target.weekId);

  // Collected inside the ingest transaction, settled after it commits: holding
  // the games transaction open across every affected league's settlement would
  // make one slow league block score ingestion for all of them, and settlement
  // is idempotent so it loses nothing by running separately.
  const finalGameIds: string[] = [];

  const ingested = await db.transaction(async (tx) => {
    const ourGames = await tx.select().from(games).where(inArray(games.weekId, weekIds));

    let gamesUpdated = 0;
    let wentFinal = 0;
    let missingFromProvider = 0;
    const matchedProviderIds = new Set<string>();

    for (const ours of ourGames) {
      const providerGame = providerGamesById.get(ours.providerGameId);
      if (!providerGame) {
        // The provider no longer returns this game — leave it untouched.
        missingFromProvider += 1;
        continue;
      }
      matchedProviderIds.add(ours.providerGameId);

      // The game clock counts as a change on its own: `updated_at` is what
      // reads serve as the live state's as-of instant (DATA-8), so a tick that
      // didn't rewrite the row would be shown under a stale timestamp.
      const changed =
        ours.status !== providerGame.status ||
        ours.homeScore !== providerGame.homeScore ||
        ours.awayScore !== providerGame.awayScore ||
        ours.period !== providerGame.period ||
        ours.clockSeconds !== providerGame.clockSeconds;
      if (!changed) continue;

      const becameFinal =
        ours.status !== GAME_STATUS.FINAL && providerGame.status === GAME_STATUS.FINAL;

      await tx
        .update(games)
        // kickoff/schedule changes are schedule-sync's job.
        .set({
          status: providerGame.status,
          homeScore: providerGame.homeScore,
          awayScore: providerGame.awayScore,
          period: providerGame.period,
          clockSeconds: providerGame.clockSeconds,
          updatedAt: now,
        })
        .where(eq(games.id, ours.id));
      gamesUpdated += 1;

      if (becameFinal) {
        wentFinal += 1;
        finalGameIds.push(ours.id);
        logInfo("nfl-sync-scores.final", { providerGameId: providerGame.providerGameId });
      }
    }

    // Provider games we've never ingested — schedule-sync owns creation, so we
    // ignore them here, only counting for observability.
    let unknownProviderGames = 0;
    for (const providerGameId of providerGamesById.keys()) {
      if (!matchedProviderIds.has(providerGameId)) unknownProviderGames += 1;
    }

    return {
      activeGames,
      weeksFetched: targets.length,
      gamesUpdated,
      wentFinal,
      missingFromProvider,
      unknownProviderGames,
    };
  });

  // Scores and standings move together (arch §Background Jobs): a game going
  // final resolves its picks and rebuilds the affected leagues' standings on
  // the same tick.
  const settled = await settlePicksForGames(db, clock, finalGameIds);

  return {
    ...ingested,
    settledLeagueSeasons: settled.leagueSeasons,
    settledResults: settled.results,
    // Surfaced because a non-zero value here usually means a final game carries
    // no score — a provider fault the next sync, or a hand SQL edit, corrects.
    settledUnsettled: settled.unsettled,
  };
}
