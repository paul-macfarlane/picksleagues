import { asc, count, eq, inArray } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, weeks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_MODE,
  LEAGUE_SETTINGS_SCHEMAS,
  isWeekInSeasonRange,
  type LeagueWeek,
  type LeagueWeeksResponse,
  type WeekType,
} from "@picksleagues/schemas";
import { getLeagueWithCurrentSeason } from "./leagues/current-season";
import { getMembership } from "./leagues/authz";
import { resolveGameOverrides } from "./games";
import { isLocked, isPickable } from "./slate";

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
  // (postseason follows week 18) that `isWeekInSeasonRange` owns, and no SQL
  // predicate can push it down without restating it.
  const inRange = rows.filter((row) => isWeekInSeasonRange(row, settings));

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
 *
 * The single definition of "the current week" for every surface that has to name
 * one, week list and dashboard glance alike. A second definition surfaces as the
 * dashboard and the pick screen disagreeing about which week a member owes, so
 * callers pass their own in-range rows here rather than re-deriving the choice.
 * Rows must arrive in season order — the last-played fallback is positional.
 */
export function resolveCurrentWeekId(
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

/**
 * What resolving a league's current week frame needs. `playsWeek` is the
 * caller's own range clip because the clip is mode-specific — Survivor is
 * regular-season only, Pick'em's range may reach the Super Bowl — and it is per
 * league rather than per season, since two leagues can share a season and
 * configure different ranges over it.
 */
export interface LeagueWeekFrameInput {
  leagueSeasonId: string;
  seasonId: string;
  playsWeek: (week: { weekType: WeekType; weekNumber: number }) => boolean;
}

export interface LeagueWeekFrame {
  weekId: string;
  /** Some game in the week is unstarted and pickable. */
  open: boolean;
  /**
   * Whether the week holds ingested games at all — reported as a fact rather
   * than folded into `open`, because what an empty week *means* is the caller's
   * rule and the two modes answer it differently: a Survivor week that has
   * closed against nobody must not announce a miss, while a Pick'em week with
   * nothing to pick is the same closed week its pick screen already shows.
   * Reachable well past preseason: postseason weeks exist before their games
   * are assigned.
   */
  hasGames: boolean;
}

/**
 * Which week each league is on, and the two facts about it a glance is built
 * from — the shared input to both modes' dashboard glances
 * (`survivor/pick-status`, `pickem/pick-status`), which read those facts
 * differently and must not disagree about the facts themselves.
 *
 * Batched across leagues rather than resolved per card: the glance sits on the
 * dashboard's critical path and a member can be in many leagues, so its query
 * count is constant whatever that count is.
 *
 * Two rules it exists to keep in one place:
 * - **Lock is derived, never stored** (arch D11) — openness is computed from
 *   each game's effective kickoff against the injected Clock. Deliberately not
 *   computed in the browser: under the simulator the browser sits at a
 *   different instant from the API, so a browser-derived lock would contradict
 *   the very states every other surface computed.
 * - **The current week has one definition** — `resolveCurrentWeekId`, the same
 *   one the league week list answers with, so the dashboard cannot point a
 *   member at a different week than the pick screen does.
 *
 * Keyed by `leagueSeasonId`; a league whose season holds no in-range week is
 * absent rather than framed, because there is no week for it to owe a pick for.
 */
export async function resolveLeagueWeekFrames(
  db: Db,
  clock: Clock,
  leagues: readonly LeagueWeekFrameInput[],
): Promise<Map<string, LeagueWeekFrame>> {
  const frames = new Map<string, LeagueWeekFrame>();
  if (leagues.length === 0) return frames;

  const seasonIds = [...new Set(leagues.map((league) => league.seasonId))];

  // Ordered by start instant like the week list, with the week number as a
  // tiebreak so the "last played" fallback lands on the same row twice.
  const weekRows = await db
    .select({
      id: weeks.id,
      seasonId: weeks.seasonId,
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
      startsAt: weeks.startsAt,
      endsAt: weeks.endsAt,
    })
    .from(weeks)
    .where(inArray(weeks.seasonId, seasonIds))
    .orderBy(asc(weeks.startsAt), asc(weeks.weekNumber));

  const weeksBySeason = new Map<string, typeof weekRows>();
  for (const row of weekRows) {
    const bucket = weeksBySeason.get(row.seasonId);
    if (bucket) bucket.push(row);
    else weeksBySeason.set(row.seasonId, [row]);
  }

  const currentWeekByLeague = new Map<string, string>();
  for (const league of leagues) {
    const inRange = (weeksBySeason.get(league.seasonId) ?? []).filter(league.playsWeek);
    const weekId = resolveCurrentWeekId(inRange, clock);
    if (weekId) currentWeekByLeague.set(league.leagueSeasonId, weekId);
  }

  const currentWeekIds = [...new Set(currentWeekByLeague.values())];
  const gameRows =
    currentWeekIds.length === 0
      ? []
      : await db.select().from(games).where(inArray(games.weekId, currentWeekIds));

  const now = clock.now();
  const weeksWithGames = new Set<string>();
  const weeksStillOpen = new Set<string>();
  for (const row of gameRows) {
    weeksWithGames.add(row.weekId);
    const effective = resolveGameOverrides(row);
    if (isPickable(effective.status) && !isLocked(effective.kickoffAt, now)) {
      weeksStillOpen.add(row.weekId);
    }
  }

  for (const [leagueSeasonId, weekId] of currentWeekByLeague) {
    frames.set(leagueSeasonId, {
      weekId,
      open: weeksStillOpen.has(weekId),
      hasGames: weeksWithGames.has(weekId),
    });
  }

  return frames;
}
