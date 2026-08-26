import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, weeks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  type LeagueMode,
  type LeagueSettings,
  type NflWeekRef,
} from "@picksleagues/schemas";

/**
 * Clock-derived league start (arch §Locking Model): the join cutoff and every
 * pre/post-start commissioner window compare against this single boundary.
 * NFL modes: earliest kickoff in the settings start week. March Madness:
 * earliest kickoff outside week 1 — the First Four (not picked, spec
 * §Bracket Structure) is modeled as the tournament's first week; revisit when
 * epic 07 fixes the NCAAMB week model (MM leagues can't exist before then —
 * creation requires an ingested NCAAMB season).
 *
 * Null (no games ingested for that week yet) means the league has not
 * started.
 */
export async function leagueStartAt(
  db: Db,
  league: { mode: LeagueMode; seasonId: string },
  settings: LeagueSettings,
): Promise<Date | null> {
  if (league.mode === LEAGUE_MODE.MARCH_MADNESS) {
    // Raw SQL fragments skip drizzle's column decoders (the driver hands back a
    // string), so the aggregate maps its own value back to a Date.
    const earliestKickoff = sql`min(${games.kickoffAt})`.mapWith((value): Date | null =>
      value === null ? null : new Date(value as string),
    );
    const [row] = await db
      .select({ startsAt: earliestKickoff })
      .from(games)
      .innerJoin(weeks, eq(games.weekId, weeks.id))
      .where(and(eq(weeks.seasonId, league.seasonId), gte(weeks.weekNumber, 2)));
    return row?.startsAt ?? null;
  }

  // Parsed, not cast: stored JSONB is only trusted through its schema, so a
  // `.default()` added later materializes here instead of being assumed
  // (engineering rules §Data). Both NFL schemas carry `startWeek`.
  const { startWeek } = LEAGUE_SETTINGS_SCHEMAS[league.mode].parse(settings);
  return nflWeekFirstKickoffAt(db, league.seasonId, startWeek);
}

// The NFL branch of `leagueStartAt` — a season and a single week's first
// kickoff, with no `LeagueSettings` cast in the way. (Its second
// caller, the preset availability core, went with ADR-0031.)
async function nflWeekFirstKickoffAt(
  db: Db,
  seasonId: string,
  week: NflWeekRef,
): Promise<Date | null> {
  // Raw SQL fragments skip drizzle's column decoders (the driver hands back a
  // string), so the aggregate maps its own value back to a Date.
  const earliestKickoff = sql`min(${games.kickoffAt})`.mapWith((value): Date | null =>
    value === null ? null : new Date(value as string),
  );
  const [row] = await db
    .select({ startsAt: earliestKickoff })
    .from(games)
    .innerJoin(weeks, eq(games.weekId, weeks.id))
    .where(
      and(
        eq(weeks.seasonId, seasonId),
        eq(weeks.weekType, week.type),
        eq(weeks.weekNumber, week.number),
      ),
    );
  return row?.startsAt ?? null;
}

/** Pre-start = no derivable start yet, or the start is still in the future. */
export function isPreStart(startsAt: Date | null, clock: Clock): boolean {
  return startsAt === null || clock.now().getTime() < startsAt.getTime();
}
