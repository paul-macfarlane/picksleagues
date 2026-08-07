import { eq, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, weeks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_MODE,
  LEAGUE_SETTINGS_INPUT_SCHEMAS,
  PICKEM_NOMINAL_RANGE,
  PICKEM_SEASON_RANGE_PRESET,
  PickemSettingsSchema,
  WEEK_TYPE,
  nflSeasonOrdinal,
  type LeagueMode,
  type LeagueSettings,
  type NflWeekRef,
  type PickemSeasonRange,
  type PickemSeasonRangePreset,
  type PickemSeasonRangePresetsResponse,
  type WeekType,
} from "@picksleagues/schemas";
import { effectiveKickoffAtSql } from "../games";
import { latestSeasonForSport, sportForMode } from "./current-season";
import { isPreStart, nflWeekFirstKickoffAt } from "./start";

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
 *   the preset's range that is still ahead. Without the second clause a league
 *   created on a Sunday afternoon would be born already started — join cutoff
 *   passed, settings frozen — before anyone was invited.
 * - **end** = the preset's nominal end, unadjusted.
 *
 * A week **with** games is still ahead until its first *effective* kickoff
 * (`override_kickoff_at ?? kickoff_at`, arch D15) via the same expression
 * `leagueStartAt` and the lock derivation use, so resolution can never disagree
 * with them about which week has begun. A week **without** games is still ahead
 * until its own `ends_at` (ADR-0021): an unseeded playoff round has no games to
 * compare, and treating it as invisible would make a Postseason league
 * uncreatable for the days between one round kicking off and the next being
 * seeded.
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
  const nominal = PICKEM_NOMINAL_RANGE[preset];
  const startOrdinal = nflSeasonOrdinal(nominal.startWeek);
  const endOrdinal = nflSeasonOrdinal(nominal.endWeek);

  // Raw SQL fragments skip drizzle's column decoders (the driver hands back a
  // string), so the aggregate maps its own value back to a Date.
  const firstKickoffAt = sql`min(${effectiveKickoffAtSql})`.mapWith((value): Date | null =>
    value === null ? null : new Date(value as string),
  );
  // Left join, not inner: a week whose round the provider hasn't seeded yet has
  // no games, but it is not thereby invisible (ADR-0021) — its own calendar
  // window, ingested from the season structure, is what places it in time.
  const weekRows = await db
    .select({
      weekType: weeks.weekType,
      weekNumber: weeks.weekNumber,
      endsAt: weeks.endsAt,
      firstKickoffAt,
    })
    .from(weeks)
    .leftJoin(games, eq(games.weekId, weeks.id))
    .where(eq(weeks.seasonId, seasonId))
    .groupBy(weeks.id, weeks.weekType, weeks.weekNumber, weeks.endsAt);

  // A season holds ~22 weeks, so the ordering and range filter run here
  // against `nflSeasonOrdinal` itself rather than a SQL restatement of it that
  // could drift from the scale the settings schema orders by.
  const now = clock.now();
  let nextUpcoming: { ordinal: number; week: NflWeekRef } | null = null;
  for (const row of weekRows) {
    const week = weekRefOf(row.weekType, row.weekNumber);
    const ordinal = nflSeasonOrdinal(week);
    if (ordinal < startOrdinal || ordinal > endOrdinal) continue;
    // `ends_at` is the games-less bound rather than `starts_at` because ESPN's
    // week windows open days before the round's first kickoff — comparing
    // `starts_at` would call a round underway while it is still entirely ahead
    // and resolve the start past it, to the following round.
    const stillAheadUntil = row.firstKickoffAt ?? row.endsAt;
    if (stillAheadUntil.getTime() <= now.getTime()) continue;
    if (!nextUpcoming || ordinal < nextUpcoming.ordinal) nextUpcoming = { ordinal, week };
  }

  // Nothing in range left to advance to — either no week has been ingested at
  // all yet, or the whole range has already run. A season whose weeks exist but
  // hold no games (the offseason path, real for most of the year) lands on the
  // second clause instead: its first week is a candidate and is its own nominal
  // start. Either way the nominal start stands; the caller's pre-start check is
  // what refuses the already-run case.
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

const ALL_PICKEM_SEASON_RANGE_PRESETS = Object.values(PICKEM_SEASON_RANGE_PRESET);

/**
 * Which of the three ADR-0020 presets a season, at one instant, can still
 * start — the exact resolve → derive → compare `createLeague` and
 * `updateLeague` each run for the one preset a request names
 * (`resolvePickemSeasonRange` → `nflWeekFirstKickoffAt` → `isPreStart`), run
 * here for all three so a preset this reports startable can never disagree
 * with the `start_week_passed` refusal a write against it would produce.
 * Names no HTTP status and needs no refusal union — an empty list is a valid
 * answer, not a failure.
 */
export async function startablePickemSeasonRangePresets(
  db: Db,
  clock: Clock,
  seasonId: string,
): Promise<PickemSeasonRangePreset[]> {
  const startable: PickemSeasonRangePreset[] = [];
  for (const preset of ALL_PICKEM_SEASON_RANGE_PRESETS) {
    const range = await resolvePickemSeasonRange(db, seasonId, preset, clock);
    const startsAt = await nflWeekFirstKickoffAt(db, seasonId, range.startWeek);
    if (isPreStart(startsAt, clock)) startable.push(preset);
  }
  return startable;
}

/**
 * The create form's availability answer, against the latest ingested NFL
 * season — the same season `createLeague` binds a new Pick'em league to
 * (`sportForMode(LEAGUE_MODE.PICKEM)` is always NFL). No ingested season at
 * all reports an empty list with a null year rather than throwing: this
 * endpoint has no refusal union to reuse `createLeague`'s `no_active_season`
 * through, and "nothing is startable yet" is the honest answer regardless.
 */
export async function pickemSeasonRangePresetsForCreate(
  db: Db,
  clock: Clock,
): Promise<PickemSeasonRangePresetsResponse> {
  const season = await latestSeasonForSport(db, sportForMode(LEAGUE_MODE.PICKEM));
  if (!season) return { seasonYear: null, startablePresets: [] };
  return {
    seasonYear: season.year,
    startablePresets: await startablePickemSeasonRangePresets(db, clock, season.id),
  };
}
