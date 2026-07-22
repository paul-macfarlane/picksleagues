import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, weeks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import { LEAGUE_MODE, type LeagueSettings, type NflWeekRef } from "@picksleagues/schemas";
import type { LeagueRow } from "./serialize";

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
 * started. Kickoffs resolve `override_kickoff_at ?? kickoff_at` (arch D15):
 * lock-derivation must follow a corrected kickoff, same as the serializers.
 */
export async function leagueStartAt(
  db: Db,
  league: Pick<LeagueRow, "mode" | "seasonId">,
  settings: LeagueSettings,
): Promise<Date | null> {
  // Raw SQL fragments skip drizzle's column decoders (the driver hands back a
  // string), so the aggregate maps its own value back to a Date.
  const earliestKickoff =
    sql`min(coalesce(${games.overrideKickoffAt}, ${games.kickoffAt}))`.mapWith(
      (value): Date | null => (value === null ? null : new Date(value as string)),
    );

  if (league.mode === LEAGUE_MODE.MARCH_MADNESS) {
    const [row] = await db
      .select({ startsAt: earliestKickoff })
      .from(games)
      .innerJoin(weeks, eq(games.weekId, weeks.id))
      .where(and(eq(weeks.seasonId, league.seasonId), gte(weeks.weekNumber, 2)));
    return row?.startsAt ?? null;
  }

  const startWeek = (settings as { startWeek: NflWeekRef }).startWeek;
  const [row] = await db
    .select({ startsAt: earliestKickoff })
    .from(games)
    .innerJoin(weeks, eq(games.weekId, weeks.id))
    .where(
      and(
        eq(weeks.seasonId, league.seasonId),
        eq(weeks.weekType, startWeek.type),
        eq(weeks.weekNumber, startWeek.number),
      ),
    );
  return row?.startsAt ?? null;
}

/** Pre-start = no derivable start yet, or the start is still in the future. */
export function isPreStart(startsAt: Date | null, clock: Clock): boolean {
  return startsAt === null || clock.now().getTime() < startsAt.getTime();
}
