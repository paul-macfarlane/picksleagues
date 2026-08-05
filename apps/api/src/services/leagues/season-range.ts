import { eq, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, weeks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_SETTINGS_INPUT_SCHEMAS,
  PICKEM_SEASON_RANGE_PRESET,
  PickemSettingsSchema,
  WEEK_TYPE,
  nflSeasonOrdinal,
  type LeagueMode,
  type LeagueSettings,
  type NflWeekRef,
  type PickemSeasonRangePreset,
  type WeekType,
} from "@picksleagues/schemas";
import { effectiveKickoffAtSql } from "../games";

export type PickemSeasonRange = { startWeek: NflWeekRef; endWeek: NflWeekRef };

/**
 * Each preset's nominal range (ADR-0020 §The three presets), in the week
 * vocabulary the spec already uses: regular-season weeks 1-18, then the four
 * playoff rounds Wild Card through Super Bowl.
 */
const NOMINAL_RANGE = {
  [PICKEM_SEASON_RANGE_PRESET.REGULAR_SEASON]: {
    startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
    endWeek: { type: WEEK_TYPE.REGULAR, number: 18 },
  },
  [PICKEM_SEASON_RANGE_PRESET.POSTSEASON]: {
    startWeek: { type: WEEK_TYPE.POSTSEASON, number: 1 },
    endWeek: { type: WEEK_TYPE.POSTSEASON, number: 4 },
  },
  [PICKEM_SEASON_RANGE_PRESET.FULL_SEASON]: {
    startWeek: { type: WEEK_TYPE.REGULAR, number: 1 },
    endWeek: { type: WEEK_TYPE.POSTSEASON, number: 4 },
  },
} as const satisfies Record<PickemSeasonRangePreset, PickemSeasonRange>;

function weekRefOf(type: WeekType, number: number): NflWeekRef {
  return type === WEEK_TYPE.REGULAR
    ? { type: WEEK_TYPE.REGULAR, number }
    : { type: WEEK_TYPE.POSTSEASON, number };
}

/**
 * A preset plus the bound season and the clock become the concrete week refs
 * the rest of the system computes on (ADR-0020 §The mid-week resolution rule):
 *
 * - **start** = the later of the preset's nominal start and the next week in
 *   the preset's range whose first kickoff is still ahead. Without the second
 *   clause a league created on a Sunday afternoon would be born already
 *   started — join cutoff passed, settings frozen — before anyone was invited.
 * - **end** = the preset's nominal end, unadjusted.
 *
 * "First kickoff" is the week's *effective* kickoff (`override_kickoff_at ??
 * kickoff_at`, arch D15) via the same expression `leagueStartAt` and the lock
 * derivation use, so resolution can never disagree with them about which week
 * has begun.
 *
 * The search is confined to the preset's own range on purpose: a Regular
 * Season league created during the playoffs would otherwise resolve its start
 * to Wild Card — past its own end — and fail the stored schema's ordering
 * rule. Confined, it finds nothing, falls back to the nominal start, and meets
 * `createLeague`'s existing `start_week_passed` refusal, which is the correct
 * answer for a range that is entirely in the past.
 */
export async function resolvePickemSeasonRange(
  db: Db,
  seasonId: string,
  preset: PickemSeasonRangePreset,
  clock: Clock,
): Promise<PickemSeasonRange> {
  const nominal = NOMINAL_RANGE[preset];
  const startOrdinal = nflSeasonOrdinal(nominal.startWeek);
  const endOrdinal = nflSeasonOrdinal(nominal.endWeek);

  // Raw SQL fragments skip drizzle's column decoders (the driver hands back a
  // string), so the aggregate maps its own value back to a Date.
  const firstKickoffAt = sql`min(${effectiveKickoffAtSql})`.mapWith(
    (value): Date => new Date(value as string),
  );
  // The inner join is what makes the no-games fallback fall out rather than
  // needing a branch: a week with no games contributes no row, and a
  // provisional season (ADR-0009) contributes none at all.
  const weekRows = await db
    .select({ weekType: weeks.weekType, weekNumber: weeks.weekNumber, firstKickoffAt })
    .from(weeks)
    .innerJoin(games, eq(games.weekId, weeks.id))
    .where(eq(weeks.seasonId, seasonId))
    .groupBy(weeks.id, weeks.weekType, weeks.weekNumber);

  // A season holds ~22 weeks, so the ordering and range filter run here
  // against `nflSeasonOrdinal` itself rather than a SQL restatement of it that
  // could drift from the scale the settings schema orders by.
  const now = clock.now();
  let nextUpcoming: { ordinal: number; week: NflWeekRef } | null = null;
  for (const row of weekRows) {
    const week = weekRefOf(row.weekType, row.weekNumber);
    const ordinal = nflSeasonOrdinal(week);
    if (ordinal < startOrdinal || ordinal > endOrdinal) continue;
    if (row.firstKickoffAt.getTime() <= now.getTime()) continue;
    if (!nextUpcoming || ordinal < nextUpcoming.ordinal) nextUpcoming = { ordinal, week };
  }

  // No upcoming week to advance to — either the schedule hasn't landed yet
  // (the offseason path, real for most of the year) or the whole range has
  // already run. Either way the nominal start stands; the caller's pre-start
  // check is what refuses the second case.
  if (!nextUpcoming || nextUpcoming.ordinal <= startOrdinal) return nominal;
  return { startWeek: nextUpcoming.week, endWeek: nominal.endWeek };
}

export type ResolveLeagueSettingsResult =
  { ok: true; settings: LeagueSettings } | { ok: false; message: string };

/**
 * Wire settings to the stored shape, for the only two paths that write them:
 * creation and the pre-start settings edit (settings lock at league start, so
 * resolution can never run later — ADR-0020). Keeping both behind this means a
 * stored blob can never hold an unresolved shape.
 */
export async function resolveLeagueSettings(
  db: Db,
  clock: Clock,
  mode: LeagueMode,
  seasonId: string,
  input: unknown,
): Promise<ResolveLeagueSettingsResult> {
  const parsed = LEAGUE_SETTINGS_INPUT_SCHEMAS[mode].safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }
  // Only Pick'em's wire shape diverges from its stored shape (ADR-0020
  // §Scope) — for the other modes what the client sent already is the stored
  // settings, which is why their two dispatch maps share one schema.
  if (!("seasonRangePreset" in parsed.data)) return { ok: true, settings: parsed.data };

  const range = await resolvePickemSeasonRange(db, seasonId, parsed.data.seasonRangePreset, clock);
  // Throws rather than refusing: a range this schema rejects means resolution
  // produced start-after-end, which is a bug here and not something the
  // commissioner did — it belongs in the logged 500, not a 400 blaming them.
  return { ok: true, settings: PickemSettingsSchema.parse({ ...parsed.data, ...range }) };
}
