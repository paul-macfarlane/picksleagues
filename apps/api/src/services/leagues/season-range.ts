import { eq, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { games, weeks } from "@picksleagues/db";
import type { Clock } from "@picksleagues/core";
import {
  LEAGUE_MODE,
  LEAGUE_SETTINGS_INPUT_SCHEMAS,
  NFL_REGULAR_SEASON_RANGE,
  PickemSettingsSchema,
  SurvivorSettingsSchema,
  WEEK_TYPE,
  nflSeasonOrdinal,
  type LeagueMode,
  type LeagueSettings,
  type NflSeasonRange,
  type NflWeekRef,
  type WeekType,
} from "@picksleagues/schemas";
import { effectiveKickoffAtSql } from "../games";

function weekRefOf(type: WeekType, number: number): NflWeekRef {
  return type === WEEK_TYPE.REGULAR
    ? { type: WEEK_TYPE.REGULAR, number }
    : { type: WEEK_TYPE.POSTSEASON, number };
}

/**
 * A nominal range plus the bound season and the clock become the concrete week
 * refs the rest of the system computes on (ADR-0020 §The mid-week resolution
 * rule):
 *
 * - **start** = the later of the nominal start and the next week in the
 *   nominal range that is still ahead. Without the second clause a league
 *   created on a Sunday afternoon would be born already started — join cutoff
 *   passed, settings frozen — before anyone was invited.
 * - **end** = the nominal end, unadjusted.
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
 * The search is confined to the nominal range on purpose: a regular-season
 * range resolved during the playoffs would otherwise resolve its start to Wild
 * Card — past its own end — and fail the stored schema's ordering rule.
 * Confined, it finds nothing, falls back to the nominal start, and meets
 * `createLeague`'s existing `start_week_passed` refusal, which is the correct
 * answer for a range that is entirely in the past.
 *
 * Mode-neutral because the rule is: both NFL modes pass the fixed regular
 * season their mode allows (ADR-0024, ADR-0031). Restating it per mode would
 * let one of them drift into resolving a start week the other considers
 * already underway.
 */
export async function resolveNflSeasonRange(
  db: Db,
  seasonId: string,
  nominal: NflSeasonRange,
  clock: Clock,
): Promise<NflSeasonRange> {
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

function invalidSettings(issues: readonly { message: string }[]): ResolveLeagueSettingsResult {
  return { ok: false, message: issues[0]?.message ?? "Invalid settings." };
}

/**
 * Wire settings to the stored shape, for the only two paths that write them:
 * creation and the pre-start settings edit (settings lock at league start, so
 * resolution can never run later — ADR-0020). Keeping both behind this means a
 * stored blob can never hold an unresolved shape.
 *
 * Dispatch is on `mode`, never on the parsed shape. Survivor's input carries
 * neither week refs nor a preset (ADR-0024), so a "does it look unresolved?"
 * test would pass it straight through and store settings with no start or end
 * week at all — which the stored schema would then reject as a 500, one layer
 * too late to say anything useful. The switch is exhaustive, so a fourth mode
 * is a compile error here rather than a mode whose range nobody resolves.
 */
export async function resolveLeagueSettings(
  db: Db,
  clock: Clock,
  mode: LeagueMode,
  seasonId: string,
  input: unknown,
): Promise<ResolveLeagueSettingsResult> {
  // Each branch indexes the wire-side map with its own literal mode, which is
  // what narrows the schema (and so the parsed value) to that mode's shape —
  // the map stays the single gate every settings write passes through.
  switch (mode) {
    case LEAGUE_MODE.PICKEM: {
      const parsed = LEAGUE_SETTINGS_INPUT_SCHEMAS[LEAGUE_MODE.PICKEM].safeParse(input);
      if (!parsed.success) return invalidSettings(parsed.error.issues);
      const range = await resolveNflSeasonRange(db, seasonId, NFL_REGULAR_SEASON_RANGE, clock);
      // Throws rather than refusing: a range this schema rejects means
      // resolution produced start-after-end, which is a bug here and not
      // something the commissioner did — it belongs in the logged 500, not a
      // 400 blaming them. Same for Survivor below.
      return { ok: true, settings: PickemSettingsSchema.parse({ ...parsed.data, ...range }) };
    }
    case LEAGUE_MODE.SURVIVOR: {
      const parsed = LEAGUE_SETTINGS_INPUT_SCHEMAS[LEAGUE_MODE.SURVIVOR].safeParse(input);
      if (!parsed.success) return invalidSettings(parsed.error.issues);
      const range = await resolveNflSeasonRange(db, seasonId, NFL_REGULAR_SEASON_RANGE, clock);
      return { ok: true, settings: SurvivorSettingsSchema.parse({ ...parsed.data, ...range }) };
    }
    case LEAGUE_MODE.MARCH_MADNESS: {
      const parsed = LEAGUE_SETTINGS_INPUT_SCHEMAS[LEAGUE_MODE.MARCH_MADNESS].safeParse(input);
      if (!parsed.success) return invalidSettings(parsed.error.issues);
      // No season range to resolve, so what the client sent already is the
      // stored settings — which is why its two dispatch maps share one schema.
      return { ok: true, settings: parsed.data };
    }
  }
}
