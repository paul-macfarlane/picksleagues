import { and, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons, weeks } from "@picksleagues/db";
import { type Clock, type GameDataProvider, nflSeasonYearFor } from "@picksleagues/core";
import { GAME_STATUS, SPORT } from "@picksleagues/schemas";
import { logInfo } from "../lib/logger";

/** A refresh target: one provider week fetch mapped to our week row. */
type ScoreTarget = { weekId: string; seasonYear: number; weekNumber: number };

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
 * harmless. Load-bearing invariant (arch D15): only provider-synced fields are
 * written — never any `override_*` column — so a re-sync can never clobber an
 * admin correction.
 */
export async function syncScores(
  db: Db,
  clock: Clock,
  provider: GameDataProvider,
  opts?: { seasonYear?: number; weekNumber?: number },
): Promise<Record<string, string | number | boolean>> {
  // One `now` per run, bound into SQL as a parameter (arch D13) — never SQL now().
  const now = clock.now();
  const seasonYear = opts?.seasonYear ?? nflSeasonYearFor(now);
  // A week takes the explicit "refresh this week now" path (season is derived
  // when omitted, matching sync-schedule/sync-odds). Season alone stays on the
  // active-games gate — it only re-labels the season the gate's own join already
  // resolves, so there's nothing to short-circuit.
  const explicit = opts?.weekNumber !== undefined;

  let targets: ScoreTarget[];
  let activeGames = 0;

  if (explicit) {
    // An explicit admin/simulator trigger means "refresh this week now" — skip
    // the active-games gate and resolve the requested week from our tables.
    const weekNumber = opts!.weekNumber!;
    const [week] = await db
      .select({ weekId: weeks.id, weekNumber: weeks.weekNumber })
      .from(weeks)
      .innerJoin(sportSeasons, eq(weeks.seasonId, sportSeasons.id))
      .where(
        and(
          eq(sportSeasons.sport, SPORT.NFL),
          eq(sportSeasons.year, seasonYear),
          eq(weeks.weekNumber, weekNumber),
        ),
      );
    if (!week) {
      // Sync jobs never create reference data — schedule-sync owns season/week
      // creation (feedback: recurring syncs query reference data, don't upsert).
      return { skipped: true, reason: "week_not_synced" };
    }
    targets = [{ weekId: week.weekId, seasonYear, weekNumber }];
  } else {
    // Fast no-op path: one indexed query (games_status_kickoff_idx) — any game
    // that has kicked off and is not yet resolved.
    const activeRows = await db
      .select({ weekId: games.weekId })
      .from(games)
      .where(and(inArray(games.status, ACTIVE_STATUSES), lte(games.kickoffAt, now)));
    activeGames = activeRows.length;
    if (activeGames === 0) {
      return { skipped: true, reason: "no_active_games", activeGames: 0 };
    }

    // Distinct weeks of the active games → the (season, week) pairs to refresh.
    const distinctWeekIds = [...new Set(activeRows.map((row) => row.weekId))];
    const weekRows = await db
      .select({ weekId: weeks.id, seasonYear: sportSeasons.year, weekNumber: weeks.weekNumber })
      .from(weeks)
      .innerJoin(sportSeasons, eq(weeks.seasonId, sportSeasons.id))
      .where(inArray(weeks.id, distinctWeekIds));
    targets = weekRows;
  }

  // Network I/O outside any transaction (engineering rules: never hold a
  // transaction open across a network call).
  const fetched = await Promise.all(
    targets.map((target) => provider.fetchWeekGames(target.seasonYear, target.weekNumber)),
  );
  const providerGamesById = new Map(
    fetched.flat().map((game) => [game.providerGameId, game]),
  );

  const weekIds = targets.map((target) => target.weekId);

  return db.transaction(async (tx) => {
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

      const changed =
        ours.status !== providerGame.status ||
        ours.homeScore !== providerGame.homeScore ||
        ours.awayScore !== providerGame.awayScore;
      if (!changed) continue;

      const becameFinal =
        ours.status !== GAME_STATUS.FINAL && providerGame.status === GAME_STATUS.FINAL;

      await tx
        .update(games)
        // Provider fields only — every override_* column is deliberately absent
        // (arch D15). kickoff/schedule changes are schedule-sync's job.
        .set({
          status: providerGame.status,
          homeScore: providerGame.homeScore,
          awayScore: providerGame.awayScore,
          updatedAt: now,
        })
        .where(eq(games.id, ours.id));
      gamesUpdated += 1;

      if (becameFinal) {
        wentFinal += 1;
        logInfo("sync-scores.final", { providerGameId: providerGame.providerGameId });
        // PKM-4 hookup site: settlement is invoked here once a game goes final
        // (deferred to that task — sync-scores only ingests the final result).
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
}
