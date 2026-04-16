import { fromZonedTime, toZonedTime } from "date-fns-tz";

import type { EventStatus, SeasonType } from "@/lib/db/schema/sports";

const EASTERN_TZ = "America/New_York";
const LOCK_HOUR = 13; // 1:00 PM
const BOUNDARY_HOUR = 2; // 2:00 AM

const SUNDAY = 0;
const TUESDAY = 2;
const SATURDAY = 6;

function easternToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
): Date {
  // Construct a local Date with these components, then let fromZonedTime
  // reinterpret the local representation as Eastern wall-clock time.
  return fromZonedTime(new Date(year, month, day, hour, 0, 0, 0), EASTERN_TZ);
}

function getEasternComponents(date: Date): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
} {
  const eastern = toZonedTime(date, EASTERN_TZ);
  return {
    year: eastern.getFullYear(),
    month: eastern.getMonth(),
    day: eastern.getDate(),
    dayOfWeek: eastern.getDay(),
  };
}

export function calculatePickLockTime(
  phaseStartDate: Date,
  seasonType: SeasonType,
): Date {
  const targetDay = seasonType === "regular" ? SUNDAY : SATURDAY;
  const { year, month, day, dayOfWeek } = getEasternComponents(phaseStartDate);

  const daysUntilTarget = (targetDay - dayOfWeek + 7) % 7;
  return easternToUtc(year, month, day + daysUntilTarget, LOCK_HOUR);
}

export function calculatePhaseStartBoundary(earliestEventStart: Date): Date {
  const { year, month, day, dayOfWeek } =
    getEasternComponents(earliestEventStart);

  const daysSinceTuesday = (dayOfWeek - TUESDAY + 7) % 7;
  const boundary = easternToUtc(
    year,
    month,
    day - daysSinceTuesday,
    BOUNDARY_HOUR,
  );

  // If the event is before Tuesday 2 AM ET, go back one more week
  if (boundary.getTime() > earliestEventStart.getTime()) {
    return easternToUtc(year, month, day - daysSinceTuesday - 7, BOUNDARY_HOUR);
  }

  return boundary;
}

export function calculatePhaseEndBoundary(latestEventStart: Date): Date {
  const { year, month, day, dayOfWeek } =
    getEasternComponents(latestEventStart);

  const daysUntilTuesday = (TUESDAY - dayOfWeek + 7) % 7;
  const boundary = easternToUtc(
    year,
    month,
    day + daysUntilTuesday,
    BOUNDARY_HOUR,
  );

  // If we're already past Tuesday 2 AM on a Tuesday, go to next week
  if (
    daysUntilTuesday === 0 &&
    latestEventStart.getTime() >= boundary.getTime()
  ) {
    return easternToUtc(year, month, day + 7, BOUNDARY_HOUR);
  }

  return boundary;
}

const NFL_SEASON_MONTHS = new Set([0, 1, 7, 8, 9, 10, 11]); // Jan, Feb, Aug–Dec
const GAME_WINDOW_LEAD_MS = 30 * 60 * 1000; // 30 minutes

export function isNflSeasonMonth(now?: Date): boolean {
  const month = (now ?? new Date()).getMonth();
  return NFL_SEASON_MONTHS.has(month);
}

export function isGameWindowActive(
  events: { startTime: Date; status: EventStatus }[],
  now?: Date,
): boolean {
  const currentTime = now ?? new Date();
  const windowCutoff = currentTime.getTime() + GAME_WINDOW_LEAD_MS;
  return events.some(
    (event) =>
      event.status === "in_progress" ||
      event.startTime.getTime() <= windowCutoff,
  );
}
