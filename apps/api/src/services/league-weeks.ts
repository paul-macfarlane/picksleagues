import { asc, count, eq } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, weeks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  WEEK_TYPE,
  nflSeasonOrdinal,
  type LeagueWeek,
  type LeagueWeeksResponse,
} from "@picksleagues/schemas";
import { getLeagueWithCurrentSeason } from "./leagues/current-season";
import { getMembership } from "./leagues/authz";

/**
 * The weeks a league actually plays — its season's weeks clipped to the
 * configured Start/End Week (spec §Pick'em League Settings). Members need this
 * to move between weeks; the admin season browser is not reachable to them, and
 * it wouldn't answer the "which weeks does MY league cover" question anyway.
 *
 * Mode-agnostic surface behind a gate that names the modes whose settings
 * carry a start/end week range — both NFL modes do, and both read this same
 * list. March Madness has no season range at all, so it is refused rather than
 * served a week list its settings cannot clip.
 */

export type LeagueWeeksResult =
  | { ok: true; value: LeagueWeeksResponse }
  | { ok: false; reason: "league_not_found" | "wrong_league_mode" };

export async function listLeagueWeeks(
  db: Db,
  clock: Clock,
  leagueId: string,
  userId: string,
): Promise<LeagueWeeksResult> {
  const current = await getLeagueWithCurrentSeason(db, leagueId);
  if (!current) return { ok: false, reason: "league_not_found" };

  const membership = await getMembership(db, leagueId, userId);
  if (!membership) return { ok: false, reason: "league_not_found" };

  const mode = current.league.mode;
  if (mode !== LEAGUE_MODE.PICKEM && mode !== LEAGUE_MODE.SURVIVOR) {
    return { ok: false, reason: "wrong_league_mode" };
  }

  const settings = LEAGUE_SETTINGS_SCHEMAS[mode].parse(current.season.settings);
  const startOrdinal = nflSeasonOrdinal(settings.startWeek);
  const endOrdinal = nflSeasonOrdinal(settings.endWeek);

  const rows = await db
    .select({
      id: weeks.id,
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
      label: weeks.label,
      startsAt: weeks.startsAt,
      endsAt: weeks.endsAt,
      gameCount: count(games.id),
    })
    .from(weeks)
    .leftJoin(games, eq(games.weekId, weeks.id))
    .where(eq(weeks.seasonId, current.season.seasonId))
    .groupBy(weeks.id)
    .orderBy(asc(weeks.startsAt));

  // Clipped in app code rather than SQL: the ordinal is a domain rule
  // (postseason follows week 18) that `nflSeasonOrdinal` already owns, and a
  // season's week list is a couple of dozen rows.
  const inRange = rows.filter((row) => {
    const ordinal = nflSeasonOrdinal(
      row.weekType === WEEK_TYPE.REGULAR
        ? { type: WEEK_TYPE.REGULAR, number: row.weekNumber }
        : { type: WEEK_TYPE.POSTSEASON, number: row.weekNumber },
    );
    return ordinal >= startOrdinal && ordinal <= endOrdinal;
  });

  const serialized: LeagueWeek[] = inRange.map((row) => ({
    id: row.id,
    weekType: row.weekType,
    weekNumber: row.weekNumber,
    label: row.label,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    gameCount: row.gameCount,
  }));

  return {
    ok: true,
    value: { weeks: serialized, currentWeekId: resolveCurrentWeekId(inRange, clock) },
  };
}

/**
 * Which week a member lands on by default: the one in progress, else the next
 * one to start, else the last played. Null only when the league has no weeks.
 * Derived from the Clock per request — never stored (arch D11).
 */
function resolveCurrentWeekId(
  rows: ReadonlyArray<{ id: string; startsAt: Date; endsAt: Date }>,
  clock: Clock,
): string | null {
  if (rows.length === 0) return null;
  const now = clock.now().getTime();

  const inProgress = rows.find(
    (row) => row.startsAt.getTime() <= now && now < row.endsAt.getTime(),
  );
  if (inProgress) return inProgress.id;

  const upcoming = rows.find((row) => row.startsAt.getTime() > now);
  if (upcoming) return upcoming.id;

  return rows[rows.length - 1]?.id ?? null;
}
