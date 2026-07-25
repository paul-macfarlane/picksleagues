import { eq, max, min, sql } from "drizzle-orm";
import type { Db } from "@picksleagues/db";
import { getSimState, games, setSimClockOffsetMs, weeks } from "@picksleagues/db";
import { SIM_GAME_DURATION_MS, type Clock } from "@picksleagues/core";
import {
  ERROR_CODE,
  SIM_CLOCK_ADJUSTMENT_KIND,
  SIM_CLOCK_ANCHOR,
  type SimClockAdjustment,
  type SimClockState,
} from "@picksleagues/schemas";

// Landing exactly on a kickoff would put the week's first game already locked,
// which is never what "take me to just before the games" means. A minute is
// comfortably inside any gap between real kickoffs.
const BEFORE_KICKOFF_MARGIN_MS = 60 * 1000;

// Clears the far edge of the last game's window rather than landing on it, so
// the jump doesn't depend on the projection's half-open boundary.
const AFTER_GAME_MARGIN_MS = 60 * 1000;

/**
 * The one place a `SimClockState` is built, from the two independent values it
 * actually has — real time and the offset. Everything else is derived, so the
 * three fields cannot contradict each other.
 *
 * This matters most right after a write: the request's `Clock` was resolved
 * from the *previous* offset, so reading `clock.now()` alongside the freshly
 * stored offset would report a `now` and an `offsetMs` that disagree.
 */
export function simClockStateFrom(realNowMs: number, offsetMs: number): SimClockState {
  return {
    now: new Date(realNowMs + offsetMs).toISOString(),
    realNow: new Date(realNowMs).toISOString(),
    offsetMs,
  };
}

/**
 * Real time and the offset it was derived from, in one read — the starting point
 * for every simulator write.
 *
 * Real time is *derived* by subtracting the stored offset rather than read
 * separately: the simulated clock is system time plus that offset (arch D13), so
 * subtracting is what keeps a computed instant consistent with the clock the
 * request is already using. Every caller needs both halves, which is why they
 * come back together rather than as two lookups that could straddle a write.
 */
export async function readRealNow(
  db: Db,
  clock: Clock,
): Promise<{ realNowMs: number; offsetMs: number; activeScenarioId: string | null }> {
  const { offsetMs, activeScenarioId } = await getSimState(db);
  return { realNowMs: clock.now().getTime() - offsetMs, offsetMs, activeScenarioId };
}

export type SimClockRefusal =
  typeof ERROR_CODE.WEEK_NOT_FOUND | typeof ERROR_CODE.WEEK_HAS_NO_GAMES;

export type AdjustSimClockResult =
  { ok: true; state: SimClockState } | { ok: false; reason: SimClockRefusal };

/**
 * Resolves a week-anchored jump against our own ingested rows — never the
 * provider (engineering rules: request paths never call ESPN) — and always
 * through the effective kickoff, so a corrected kickoff moves the anchor with it
 * (arch D15).
 */
async function resolveWeekAnchorInstant(
  db: Db,
  anchor: Extract<SimClockAdjustment, { kind: typeof SIM_CLOCK_ADJUSTMENT_KIND.WEEK }>,
): Promise<{ ok: true; instant: Date } | { ok: false; reason: SimClockRefusal }> {
  const { weekId } = anchor;
  const [week] = await db
    .select({ startsAt: weeks.startsAt })
    .from(weeks)
    .where(eq(weeks.id, weekId));
  if (!week) {
    return { ok: false, reason: ERROR_CODE.WEEK_NOT_FOUND };
  }

  if (anchor.anchor === SIM_CLOCK_ANCHOR.WEEK_START) {
    return { ok: true, instant: week.startsAt };
  }

  // `least`/`greatest` of the provider and override kickoffs rather than the
  // effective one alone. An override moves a game's *lock* (D15) but not the
  // fixture the simulated provider projects from, so an override that pulls the
  // last game earlier would otherwise drag `after_last_game` in front of a game
  // still projecting as scheduled. Taking the outer bound in each direction
  // keeps both anchors conservative: never after a game that hasn't started,
  // never before one that has.
  const [bounds] = await db
    .select({
      firstKickoff: min(
        sql<Date>`least(${games.kickoffAt}, coalesce(${games.overrideKickoffAt}, ${games.kickoffAt}))`,
      ),
      lastKickoff: max(
        sql<Date>`greatest(${games.kickoffAt}, coalesce(${games.overrideKickoffAt}, ${games.kickoffAt}))`,
      ),
    })
    .from(games)
    .where(eq(games.weekId, weekId));

  // `min`/`max` over zero rows come back null — the week is synced but its games
  // are not, which is precisely the case an operator needs told rather than
  // silently landing on the week's nominal start.
  if (!bounds?.firstKickoff || !bounds.lastKickoff) {
    return { ok: false, reason: ERROR_CODE.WEEK_HAS_NO_GAMES };
  }

  if (anchor.anchor === SIM_CLOCK_ANCHOR.BEFORE_FIRST_KICKOFF) {
    return {
      ok: true,
      instant: new Date(new Date(bounds.firstKickoff).getTime() - BEFORE_KICKOFF_MARGIN_MS),
    };
  }

  // AFTER_LAST_GAME: past the end of the last game's window, so every game that
  // is going to be played has finished. Cancelled and postponed fixtures still
  // report their own terminal status at every instant by design, so this is
  // "nothing is still pending", not "everything reads final".
  //
  // Anchors are computed from *ingested* rows while the projection reads
  // fixtures, so a fixture edited since the last sync can still be pending here
  // — re-run the schedule sync before jumping.
  return {
    ok: true,
    instant: new Date(
      new Date(bounds.lastKickoff).getTime() + SIM_GAME_DURATION_MS + AFTER_GAME_MARGIN_MS,
    ),
  };
}

/**
 * Moves the simulated clock (SIM-2). The offset is persisted in `app_state` so
 * every serverless instance agrees on simulated time (arch D13); it takes effect
 * on the next request, since each request resolves its clock once at the start.
 */
export async function adjustSimClock(
  db: Db,
  clock: Clock,
  adjustment: SimClockAdjustment,
): Promise<AdjustSimClockResult> {
  // One read of real time, so every branch below shifts from the same instant.
  const { realNowMs, offsetMs: currentOffsetMs } = await readRealNow(db, clock);

  const offsetFor = (targetMs: number) => targetMs - realNowMs;

  let nextOffsetMs: number;
  switch (adjustment.kind) {
    case SIM_CLOCK_ADJUSTMENT_KIND.INSTANT:
      nextOffsetMs = offsetFor(new Date(adjustment.instant).getTime());
      break;
    case SIM_CLOCK_ADJUSTMENT_KIND.ADVANCE:
      nextOffsetMs = currentOffsetMs + adjustment.ms;
      break;
    case SIM_CLOCK_ADJUSTMENT_KIND.WEEK: {
      const resolved = await resolveWeekAnchorInstant(db, adjustment);
      if (!resolved.ok) {
        return resolved;
      }
      nextOffsetMs = offsetFor(resolved.instant.getTime());
      break;
    }
    case SIM_CLOCK_ADJUSTMENT_KIND.RESET:
      nextOffsetMs = 0;
      break;
  }

  // Truncated because the column is a bigint of whole milliseconds; a fractional
  // offset would be silently rounded by the driver instead of by us.
  nextOffsetMs = Math.trunc(nextOffsetMs);
  await setSimClockOffsetMs(db, nextOffsetMs);

  return { ok: true, state: simClockStateFrom(realNowMs, nextOffsetMs) };
}
