import { and, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, sportSeasons } from "@picksleagues/db";
import { type Clock, type GameDataProvider, nflSeasonYearFor } from "@picksleagues/core";
import {
  JOB_SKIP_REASON,
  SPORT,
  UNSTARTED_GAME_STATUSES,
  WEEK_TYPE,
  type WeekType,
} from "@picksleagues/schemas";
import { resolveRecurringSyncSeasonYear } from "./season-lifecycle";
import { resolveTargetWeeks, type TargetWeek } from "./target-weeks";

/**
 * Maintains the current spread on each unstarted game in the current NFL week
 * **and the week after it** (arch §Spread strategy): one number per game,
 * overwritten in place. No history is kept — the audit that matters is what a
 * member accepted, which is denormalized onto the pick as
 * `pickem_picks.spread_at_pick` (ADR-0018). Re-running is a true no-op when the
 * line hasn't moved: the same provider response leaves identical row state.
 *
 * Two weeks, not one (SIMP-16). Verified against the live ESPN core API on
 * 2026-08-05: after the opening week, an ESPN week runs Wednesday ~07:00Z to
 * the following Wednesday ~06:59Z and the windows are contiguous. So on a
 * Tuesday the week matching `startsAt <= now < endsAt` is the one whose games
 * were all played the preceding Thursday/Sunday/Monday — every one of them
 * fails the `kickoff > now` filter, and a current-week-only target priced
 * nothing at all. Locking is `kickoff > now`, so members can already pick the
 * coming weekend; without a line an ATS league refuses every one of those picks
 * with `spread_unavailable` until Wednesday ~3am ET.
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
  const targetWeeks = await resolveTargetWeeks(
    db,
    season.id,
    now,
    opts?.weekNumber,
    opts?.weekType ?? WEEK_TYPE.REGULAR,
  );
  const [anchorWeek] = targetWeeks;
  if (!anchorWeek) {
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

  let unstartedGames = 0;
  let spreadsUpdated = 0;
  let gamesWithoutOdds = 0;
  for (const week of targetWeeks) {
    const counts = await priceUnstartedGames(db, provider, seasonYear, week, now);
    unstartedGames += counts.unstartedGames;
    spreadsUpdated += counts.spreadsUpdated;
    gamesWithoutOdds += counts.gamesWithoutOdds;
  }

  return {
    seasonYear,
    // The anchor week the run resolved. The counters below are totals across
    // every week the run covered — `weeksTargeted` says how many that was.
    weekType: anchorWeek.weekType,
    weekNumber: anchorWeek.weekNumber,
    weeksTargeted: targetWeeks.length,
    unstartedGames,
    // Rows actually written, matching `sync-scores`' `gamesUpdated`: a re-run
    // over an unmoved line reports 0, which is the no-op saying so.
    spreadsUpdated,
    gamesWithoutOdds,
  };
}

/** Prices one week's unstarted games in place, reporting what it touched. */
async function priceUnstartedGames(
  db: Db,
  provider: GameDataProvider,
  seasonYear: number,
  week: TargetWeek,
  now: Date,
): Promise<{ unstartedGames: number; spreadsUpdated: number; gamesWithoutOdds: number }> {
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
    .select({
      id: games.id,
      providerGameId: games.providerGameId,
      spread: games.spread,
      spreadSource: games.spreadSource,
    })
    .from(games)
    .where(
      and(
        eq(games.weekId, week.id),
        gt(games.kickoffAt, now),
        inArray(games.status, [...UNSTARTED_GAME_STATUSES]),
      ),
    );

  // Nothing to price is nothing to fetch — a spent week costs no provider call.
  if (unstartedGames.length === 0) {
    return { unstartedGames: 0, spreadsUpdated: 0, gamesWithoutOdds: 0 };
  }

  // Network read outside any transaction (engineering rules: never hold a
  // transaction open across a network call).
  const providerGames = await provider.fetchNflWeekGames(
    seasonYear,
    week.weekType,
    week.weekNumber,
  );
  const providerGameByProviderId = new Map(
    providerGames.map((game) => [game.providerGameId, game]),
  );

  let gamesWithoutOdds = 0;
  let spreadsUpdated = 0;
  for (const game of unstartedGames) {
    const providerGame = providerGameByProviderId.get(game.providerGameId);
    const spread = providerGame?.spread;
    // Missing from the provider response (undefined) or no line yet (null /
    // non-finite) both count as "no odds". A game we can't price is left
    // exactly as it was rather than nulled: the provider dropping a line for one
    // response is a blip, and clearing the number would refuse every ATS pick on
    // that game until the next run put it back.
    if (!providerGame || typeof spread !== "number" || !Number.isFinite(spread)) {
      gamesWithoutOdds += 1;
      continue;
    }
    // The book behind the number (PKM-9), written alongside it in the same
    // `set()` below so the two can never attribute a stored spread to the
    // wrong book.
    const spreadSource = providerGame.spreadSource;
    // Skip the write when neither has moved — this is what makes a re-run a
    // true no-op rather than one that merely lands the same numbers.
    // `updated_at` is served as the row's as-of instant (DATA-8), so rewriting
    // an unchanged row would restamp it with nothing to show for it. The source
    // is checked alongside the number: a book rotation with the line unmoved is
    // still a change this job must persist.
    if (game.spread === spread && game.spreadSource === spreadSource) continue;

    await db
      // Provider fields only — every `override_*` column is deliberately absent
      // (arch D15), so a correction survives every re-sync.
      .update(games)
      .set({ spread, spreadSource, updatedAt: now })
      .where(eq(games.id, game.id));
    spreadsUpdated += 1;
  }

  return { unstartedGames: unstartedGames.length, spreadsUpdated, gamesWithoutOdds };
}
