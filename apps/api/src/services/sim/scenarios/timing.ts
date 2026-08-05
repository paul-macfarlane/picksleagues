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

const WEEK1_STARTS_AT_OFFSET_MS = 0;
const WEEK1_ENDS_AT_OFFSET_MS = 7 * DAY_MS;

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
 * Week 1 of the shared regular-season cast, reused by every scenario.
 *
 * It is the only week the library declares. `week-move` was the one scenario
 * that spanned two, and it went with ADR-0019; a `WEEK_2` nothing declared
 * would be a definition kept warm for a rule the product no longer has. A
 * scenario that genuinely needs a second week adds it back with its own reason.
 */
export const WEEK_1: SimWeekDef = {
  weekType: WEEK_TYPE.REGULAR,
  weekNumber: 1,
  label: "Week 1",
  startsAtOffsetMs: WEEK1_STARTS_AT_OFFSET_MS,
  endsAtOffsetMs: WEEK1_ENDS_AT_OFFSET_MS,
};
