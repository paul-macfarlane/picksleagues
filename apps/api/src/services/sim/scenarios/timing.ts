import { WEEK_TYPE } from "@picksleagues/schemas";
import type { SimWeekDef } from "../definition";

/**
 * Shared offset arithmetic for the canned scenario library (SIM-4). Every
 * scenario declares times as offsets from the anchor `materializeDefinition`
 * resolves against, so a freshly loaded scenario always lands with its games
 * in the future relative to wherever the simulated clock is placed on load.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const WEEK_SPAN_MS = 7 * DAY_MS;

/**
 * Kickoff offset for the `gameIndex`-th (0-indexed) game of a week starting at
 * `weekStartOffsetMs`. +3 days keeps every kickoff inside the week's window
 * with room either side; the 4-hour stagger keeps games individually
 * addressable (e.g. "advance the clock past the first game only").
 */
export function kickoffOffsetMs(weekStartOffsetMs: number, gameIndex: number): number {
  return weekStartOffsetMs + 3 * DAY_MS + gameIndex * 4 * HOUR_MS;
}

/**
 * The `index`-th (0-based) week a scenario declares, numbered `weekNumber` in
 * the regular season and occupying its own seven-day window.
 *
 * Consecutive and gapless because `resolveCurrentWeekId` picks the week whose
 * `[startsAt, endsAt)` contains the simulated now: a gap between two windows is
 * an instant at which a multi-week scenario has no current week at all, and the
 * pick screen would open on the wrong one rather than fail.
 */
export function regularSeasonWeek(weekNumber: number, index: number): SimWeekDef {
  const startsAtOffsetMs = index * WEEK_SPAN_MS;
  return {
    weekType: WEEK_TYPE.REGULAR,
    weekNumber,
    label: `Week ${weekNumber}`,
    startsAtOffsetMs,
    endsAtOffsetMs: startsAtOffsetMs + WEEK_SPAN_MS,
  };
}

/**
 * Week 1 of the shared regular-season cast, reused by every single-week
 * scenario — which is all of the edge-case fixtures, since a push, tie,
 * cancellation or postponement is a fact about one game and needs no season
 * around it. `survivor-season` is the exception, and states its own reason.
 */
export const WEEK_1: SimWeekDef = regularSeasonWeek(1, 0);
