import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons, weeks } from "@picksleagues/db";
import { type Clock, type GameDataProvider, nflSeasonYearFor } from "@picksleagues/core";
import {
  JOB_SKIP_REASON,
  SPORT,
  UNSTARTED_GAME_STATUSES,
  WEEK_TYPE,
  type WeekType,
} from "@picksleagues/schemas";
import { resolveRecurringSyncSeasonYear } from "./season-lifecycle";

/**
 * Maintains the current spread on each unstarted game in the current NFL week
 * (arch §Spread strategy): one number per game, overwritten in place. No
 * history is kept — the audit that matters is what a member accepted, which is
 * denormalized onto the pick as `pickem_picks.spread_at_pick` (ADR-0018). Re-
 * running is a true no-op when the line hasn't moved: the same provider
 * response leaves identical row state.
 *
 * Never *creates* `games`/`weeks` (that is schedule-sync's job) and never
 * writes any `override_*` column (arch D15) — a correction outlives every
 * re-sync.
 */
export async function syncNflOdds(
  db: Db,
  clock: Clock,
  provider: GameDataProvider,
  opts?: { seasonYear?: number; weekType?: WeekType; weekNumber?: number },
): Promise<Record<string, string | number | boolean>> {
  // One `now` per run: season derivation, every comparison, and every
  // `updated_at` share one instant, reaching SQL as a bound parameter (arch D13).
  const now = clock.now();
  // An explicit `?season=` always wins; otherwise the derived label rolls
  // forward to next season once this one's weeks are all behind us, so
  // offseason runs price the games members can already pick against
  // (an ATS league refuses picks on a game with no spread).
  const seasonYear =
    opts?.seasonYear ?? (await resolveRecurringSyncSeasonYear(db, nflSeasonYearFor(now), now));

  const [season] = await db
    .select({ id: sportSeasons.id })
    .from(sportSeasons)
    .where(and(eq(sportSeasons.sport, SPORT.NFL), eq(sportSeasons.year, seasonYear)));
  if (!season) {
    // Sync jobs never create reference data — schedule-sync owns season/week
    // creation (feedback: recurring syncs query reference data, don't upsert it).
    return { skipped: true, reason: JOB_SKIP_REASON.SEASON_NOT_SYNCED };
  }

  // An explicit week defaults its type to REGULAR — a bare week number is the
  // regular-season case; postseason narrowing must name `weekType`.
  const targetWeek = await resolveTargetWeek(
    db,
    season.id,
    now,
    opts?.weekNumber,
    opts?.weekType ?? WEEK_TYPE.REGULAR,
  );
  if (!targetWeek) {
    // An explicitly requested week that isn't synced is a distinct condition
    // from "no current week" on the derived path — surface the sibling jobs'
    // term (sync-scores/sync-schedule) so the two never blur together.
    return {
      skipped: true,
      reason:
        opts?.weekNumber !== undefined
          ? JOB_SKIP_REASON.WEEK_NOT_SYNCED
          : JOB_SKIP_REASON.NO_CURRENT_WEEK,
    };
  }

  // Our tables are the source of truth for what's unstarted — lock state is
  // derived, never stored (arch D11): kickoff still in the future, and a status
  // that is neither started nor abandoned.
  //
  // `UNSTARTED_GAME_STATUSES`, not `= scheduled`. A postponed game is announced
  // ahead of time and played later, so picks on it are legitimate — but keying
  // on `scheduled` alone left it with no spread, and an ATS league then refused
  // every pick on it with `spread_unavailable`, permanently. The slate calls
  // such a game pickable; this must agree, or the app offers a pick it will
  // always reject.
  const unstartedGames = await db
    .select({ id: games.id, providerGameId: games.providerGameId, spread: games.spread })
    .from(games)
    .where(
      and(
        eq(games.weekId, targetWeek.id),
        gt(games.kickoffAt, now),
        inArray(games.status, [...UNSTARTED_GAME_STATUSES]),
      ),
    );

  if (unstartedGames.length === 0) {
    return {
      seasonYear,
      weekType: targetWeek.weekType,
      weekNumber: targetWeek.weekNumber,
      unstartedGames: 0,
      spreadsUpdated: 0,
      gamesWithoutOdds: 0,
    };
  }

  // Network read outside any transaction (engineering rules: never hold a
  // transaction open across a network call).
  const providerGames = await provider.fetchNflWeekGames(
    seasonYear,
    targetWeek.weekType,
    targetWeek.weekNumber,
  );
  const spreadByProviderId = new Map(
    providerGames.map((game) => [game.providerGameId, game.spread]),
  );

  let gamesWithoutOdds = 0;
  let spreadsUpdated = 0;
  for (const game of unstartedGames) {
    const spread = spreadByProviderId.get(game.providerGameId);
    // Missing from the provider response (undefined) or no line yet (null /
    // non-finite) both count as "no odds". A game we can't price is left
    // exactly as it was rather than nulled: the provider dropping a line for one
    // response is a blip, and clearing the number would refuse every ATS pick on
    // that game until the next run put it back.
    if (typeof spread !== "number" || !Number.isFinite(spread)) {
      gamesWithoutOdds += 1;
      continue;
    }
    // Skip the write when the line hasn't moved — this is what makes a re-run a
    // true no-op rather than one that merely lands the same number. `updated_at`
    // is served as the row's as-of instant (DATA-8), so rewriting an unchanged
    // row would restamp it with nothing to show for it.
    if (game.spread === spread) continue;

    await db
      // Provider field only — every `override_*` column is deliberately absent
      // (arch D15), so a correction survives every re-sync.
      .update(games)
      .set({ spread, updatedAt: now })
      .where(eq(games.id, game.id));
    spreadsUpdated += 1;
  }

  return {
    seasonYear,
    weekType: targetWeek.weekType,
    weekNumber: targetWeek.weekNumber,
    unstartedGames: unstartedGames.length,
    // Rows actually written, matching `sync-scores`' `gamesUpdated`: a re-run
    // over an unmoved line reports 0, which is the no-op saying so.
    spreadsUpdated,
    gamesWithoutOdds,
  };
}

/**
 * Resolves the week to snapshot from OUR `weeks` table (never the provider):
 * an explicit (type, number), else the week currently in progress
 * (`startsAt <= now < endsAt`), else the next upcoming week (pre-season odds).
 * The window-based paths need no type filter — regular and postseason windows
 * never overlap, so `startsAt <= now < endsAt` picks out exactly one week.
 */
async function resolveTargetWeek(
  db: Db,
  seasonId: string,
  now: Date,
  weekNumber: number | undefined,
  weekType: WeekType,
): Promise<{ id: string; weekType: WeekType; weekNumber: number } | null> {
  const selection = { id: weeks.id, weekType: weeks.weekType, weekNumber: weeks.weekNumber };

  if (weekNumber !== undefined) {
    const [week] = await db
      .select(selection)
      .from(weeks)
      .where(
        and(
          eq(weeks.seasonId, seasonId),
          eq(weeks.weekType, weekType),
          eq(weeks.weekNumber, weekNumber),
        ),
      );
    return week ?? null;
  }

  const [current] = await db
    .select(selection)
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), lte(weeks.startsAt, now), gt(weeks.endsAt, now)))
    // Windows shouldn't overlap across week types, but don't let that provider
    // claim be load-bearing: pick the earliest-starting match deterministically.
    .orderBy(asc(weeks.startsAt))
    .limit(1);
  if (current) {
    return current;
  }

  const [next] = await db
    .select(selection)
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), gt(weeks.startsAt, now)))
    .orderBy(asc(weeks.startsAt))
    .limit(1);
  return next ?? null;
}
