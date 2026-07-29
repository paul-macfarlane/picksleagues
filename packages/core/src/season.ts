import { WEEK_TYPE } from "@picksleagues/schemas";
import type { ProviderWeek } from "./game-data-provider";

/**
 * NFL seasons are labeled by the year they start in and run Aug (regular
 * season kickoff) through Feb (Super Bowl). Jan/Feb belong to the *prior*
 * season's postseason tail, so a `now` in Jan–Jul maps back to `year - 1`;
 * Aug–Dec maps to the current UTC year. Pure function of the given instant —
 * callers pass `clock.now()` (arch D13); this module never reads time itself.
 */
export function nflSeasonYearFor(now: Date): number {
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth(); // 0-indexed: 0 = January, 7 = August
  const isAugustThroughDecember = utcMonth >= 7;
  return isAugustThroughDecember ? utcYear : utcYear - 1;
}

// 0-indexed, matching Date's month argument: the season label flips on Aug 1.
const AUGUST = 7;

/**
 * The earliest anchor at or after `earliest` for which a run of `spanMs` lies
 * wholly inside one NFL season label — `earliest` itself unless the span
 * straddles the Aug 1 flip, in which case the flip instant.
 *
 * This exists for the simulator (SIM-3). A library scenario's times are offsets
 * from its anchor, so a scenario anchored in late July has its games in August:
 * its season stamp and the year the sync jobs derive from `clock.now()` then
 * disagree for as long as the clock sits on the near side of the flip, and a
 * `SimulatedProvider` asked for a season its active scenario doesn't cover
 * returns nothing — every job a silent no-op. Stamping from the far end instead
 * only moves the disagreement to the other side of the flip. Nothing can stamp
 * one year onto a span that reads as two, so the fix is to not straddle:
 * anchoring at the flip makes the label constant across the scenario's whole
 * life, whatever the operator does with the clock.
 *
 * Assumes a span shorter than a year (library scenarios run ~2 weeks) — the
 * snapped anchor is the start of a label, so anything longer would straddle the
 * *next* flip.
 */
export function nflSeasonAlignedAnchor(earliest: Date, spanMs: number): Date {
  const seasonYear = nflSeasonYearFor(earliest);
  if (nflSeasonYearFor(new Date(earliest.getTime() + spanMs)) === seasonYear) return earliest;
  // Season `Y` starts Aug 1 of calendar year `Y`, so the next label's start is
  // the only instant the span can have spilled past.
  return new Date(Date.UTC(seasonYear + 1, AUGUST, 1));
}

/**
 * The most recent NFL season year whose Super Bowl has definitely been
 * played. This is a different question from `nflSeasonYearFor` — that
 * function answers "which season does this instant belong to" (a Jan/Feb
 * instant belongs to the *previous* label's postseason tail, i.e. a season
 * still in progress); this one answers "which season has fully finished and
 * is safe to treat as historical". Conflating the two made the replay
 * picker reject the season that had just finished, since `nflSeasonYearFor`
 * reports a season as "current" for months after its Super Bowl is over.
 *
 * Season `Y` runs Aug of `Y` through the Super Bowl in Feb of `Y+1`. March 1
 * (UTC) of `Y+1` is used as a conservative boundary — a couple of weeks past
 * the real Super Bowl — so the answer is never optimistic. Pure function of
 * the given instant; callers pass `clock.now()` or real time as needed (arch
 * D13), this module never reads time itself.
 */
export function latestCompletedNflSeasonYear(now: Date): number {
  const utcYear = now.getUTCFullYear();
  const marchFirstThisUtcYear = Date.UTC(utcYear, 2, 1);
  return now.getTime() >= marchFirstThisUtcYear ? utcYear - 1 : utcYear - 2;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const THURSDAY = 4; // Date#getUTCDay(): 0 = Sunday.

/** The first Thursday of September, UTC midnight — the NFL's real kickoff-week anchor. */
function firstThursdayOfSeptemberUtc(seasonYear: number): Date {
  const september1 = new Date(Date.UTC(seasonYear, 8, 1));
  const offsetDays = (THURSDAY - september1.getUTCDay() + 7) % 7;
  return new Date(september1.getTime() + offsetDays * MS_PER_DAY);
}

const POSTSEASON_LABELS = [
  "Wild Card",
  "Divisional Round",
  "Conference Championship",
  "Super Bowl",
] as const;

/**
 * A plausible NFL week skeleton for a season ESPN hasn't published yet
 * (ADR-0009 "upcoming seasons exist before their data"): 18 regular weeks
 * anchored to the first Thursday of September, then the 4 postseason rounds
 * continuing weekly — with an extra week's gap before the Super Bowl,
 * matching the real calendar's post-conference-championship bye. These are
 * *estimates*: the schedule sync overwrites every date/label in place the day
 * the provider publishes the real structure, and this skeleton never carries
 * games (`leagueStartAt` only ever derives from real kickoffs). Pure function
 * of the year — no Clock read, matches the module's existing convention.
 */
export function estimatedNflWeeks(seasonYear: number): ProviderWeek[] {
  const regularWeeks: ProviderWeek[] = [];
  let cursor = firstThursdayOfSeptemberUtc(seasonYear);
  for (let weekNumber = 1; weekNumber <= 18; weekNumber++) {
    const startsAt = cursor;
    const endsAt = new Date(startsAt.getTime() + MS_PER_WEEK);
    regularWeeks.push({
      weekType: WEEK_TYPE.REGULAR,
      weekNumber,
      label: `Week ${weekNumber}`,
      startsAt,
      endsAt,
    });
    cursor = endsAt;
  }

  const postseasonWeeks: ProviderWeek[] = [];
  for (const [index, label] of POSTSEASON_LABELS.entries()) {
    const weekNumber = index + 1;
    // One extra week's gap before the Super Bowl (bye week between the
    // conference championships and the big game).
    if (label === "Super Bowl") {
      cursor = new Date(cursor.getTime() + MS_PER_WEEK);
    }
    const startsAt = cursor;
    const endsAt = new Date(startsAt.getTime() + MS_PER_WEEK);
    postseasonWeeks.push({ weekType: WEEK_TYPE.POSTSEASON, weekNumber, label, startsAt, endsAt });
    cursor = endsAt;
  }

  return [...regularWeeks, ...postseasonWeeks];
}
