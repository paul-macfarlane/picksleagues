import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { sportSeasons, weeks } from "@picksleagues/db";
import { SPORT } from "@picksleagues/schemas";

/** Where a season sits relative to a given instant, derived from our week rows. */
export const SEASON_CONCLUSION = {
  /** No week rows at all — a fresh env, or a season nothing has synced yet. */
  NO_WEEKS: "no_weeks",
  /** At least one week still ends in the future. */
  UNCONCLUDED: "unconcluded",
  /** Every week has ended. */
  CONCLUDED: "concluded",
} as const;

export type SeasonConclusion = (typeof SEASON_CONCLUSION)[keyof typeof SEASON_CONCLUSION];

/**
 * Whether an NFL season's ingested weeks are all behind us, answered from OUR
 * tables (arch §External Data — never the provider on a decision path). One
 * query for the season's furthest week boundary; raw SQL `max()` skips
 * drizzle's decoder, so map it back to Date. Boundary: a last week ending
 * exactly at `now` counts as concluded. An empty aggregate is reported as
 * NO_WEEKS rather than silently reading as "concluded" — callers decide what a
 * season nobody has synced means for them.
 *
 * `now` is the caller's single per-run `clock.now()` (arch D13) and reaches SQL
 * as a bound parameter.
 */
export async function nflSeasonConclusion(
  db: Db,
  seasonYear: number,
  now: Date,
): Promise<SeasonConclusion> {
  const maxWeekEndsAt = sql<string | null>`max(${weeks.endsAt})`.mapWith((value): Date | null =>
    value === null ? null : new Date(value as string),
  );
  const [row] = await db
    .select({ maxEndsAt: maxWeekEndsAt })
    .from(weeks)
    .innerJoin(sportSeasons, eq(sportSeasons.id, weeks.seasonId))
    .where(and(eq(sportSeasons.sport, SPORT.NFL), eq(sportSeasons.year, seasonYear)));

  if (!row?.maxEndsAt) return SEASON_CONCLUSION.NO_WEEKS;
  return row.maxEndsAt.getTime() > now.getTime()
    ? SEASON_CONCLUSION.UNCONCLUDED
    : SEASON_CONCLUSION.CONCLUDED;
}

/**
 * The season year a *recurring* sync (odds, scores) should target when the
 * caller gave no explicit `?season=`. `nflSeasonYearFor` maps Jan–Jul back to
 * the prior season label, so through the whole offseason the derived default
 * points at a season whose last week is already over while next season's games
 * — already ingested by schedule-sync's ensure step (ADR-0009) — sit unsynced.
 * That is not a cosmetic no-op: an against-the-spread league can take no picks
 * at all until odds snapshots exist for its upcoming games, and locking is
 * `kickoff > now`, so members can be picking months before the label flips.
 *
 * Resolution: the derived default, unless it has nothing left to sync — every
 * week behind us (CONCLUDED) *or* no weeks at all (NO_WEEKS) — and `default + 1`
 * has week rows; then `default + 1`. NO_WEEKS belongs here because a
 * wipe-and-reseed that seeds only the upcoming season leaves the derived label
 * pointing at a season that doesn't exist, which is the same silent months-long
 * no-op by a different route. Only UNCONCLUDED — a season still in flight — pins
 * the default.
 *
 * The `default + 1` side is a weeks check rather than a season-row check for the
 * same reason: an empty row is nothing to sync, and rolling onto it would only
 * trade one no-op for another while hiding which season we meant.
 *
 * Query-only by construction: it never creates a season row. Creating next
 * year's season is schedule-sync's `ensureUpcomingNflSeason` job — recurring
 * syncs query reference data, they don't upsert it (setup owns creation), so a
 * dormant period with nothing ingested stays a harmless no-op here.
 */
export async function resolveRecurringSyncSeasonYear(
  db: Db,
  defaultSeasonYear: number,
  now: Date,
): Promise<number> {
  const conclusion = await nflSeasonConclusion(db, defaultSeasonYear, now);
  if (conclusion === SEASON_CONCLUSION.UNCONCLUDED) {
    return defaultSeasonYear;
  }

  // NO_WEEKS covers both "no season row" and "a row nothing has ingested" — one
  // query answers the only question that matters, whether there is anything
  // there to sync.
  const upcomingSeasonYear = defaultSeasonYear + 1;
  const upcoming = await nflSeasonConclusion(db, upcomingSeasonYear, now);
  return upcoming === SEASON_CONCLUSION.NO_WEEKS ? defaultSeasonYear : upcomingSeasonYear;
}
