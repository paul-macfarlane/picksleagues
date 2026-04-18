import type { League } from "@/lib/db/schema/leagues";
import type { Phase, Season, SeasonType } from "@/lib/db/schema/sports";

/**
 * A league's schedule range is an ordered pair of (seasonType, weekNumber)
 * tuples. These are season-agnostic — "regular week 1 → postseason week 5"
 * means the same thing in 2025 and 2026.
 */
export type LeagueRange = Pick<
  League,
  "startSeasonType" | "startWeekNumber" | "endSeasonType" | "endWeekNumber"
>;

/**
 * Lexicographic ordinal for (seasonType, weekNumber). Regular season weeks
 * come before postseason weeks; within a season type the weekNumber orders
 * naturally. Used to compare phase positions without caring about real dates.
 */
function phaseOrdinal(seasonType: SeasonType, weekNumber: number): number {
  return seasonType === "regular" ? weekNumber : 100 + weekNumber;
}

export function comparePhasesByOrdinal(
  a: Pick<Phase, "seasonType" | "weekNumber">,
  b: Pick<Phase, "seasonType" | "weekNumber">,
): number {
  return (
    phaseOrdinal(a.seasonType, a.weekNumber) -
    phaseOrdinal(b.seasonType, b.weekNumber)
  );
}

export function isPhaseInLeagueRange(
  phase: Pick<Phase, "seasonType" | "weekNumber">,
  range: LeagueRange,
): boolean {
  const p = phaseOrdinal(phase.seasonType, phase.weekNumber);
  const start = phaseOrdinal(range.startSeasonType, range.startWeekNumber);
  const end = phaseOrdinal(range.endSeasonType, range.endWeekNumber);
  return p >= start && p <= end;
}

export function isValidLeagueRange(range: LeagueRange): boolean {
  const start = phaseOrdinal(range.startSeasonType, range.startWeekNumber);
  const end = phaseOrdinal(range.endSeasonType, range.endWeekNumber);
  return start <= end;
}

// --- User-facing labels ---

// Postseason week numbers come from ESPN: Wild Card=1, Divisional=2,
// Conference=3, Pro Bowl=4 (filtered at sync), Super Bowl=5.
const POSTSEASON_LABELS: Record<number, string> = {
  1: "Wild Card",
  2: "Divisional",
  3: "Conference",
  5: "Super Bowl",
};

export function phaseLabel(seasonType: SeasonType, weekNumber: number): string {
  if (seasonType === "regular") return `Week ${weekNumber}`;
  return POSTSEASON_LABELS[weekNumber] ?? `Postseason ${weekNumber}`;
}

export function formatLeagueRange(range: LeagueRange): string {
  const startLabel = phaseLabel(range.startSeasonType, range.startWeekNumber);
  const endLabel = phaseLabel(range.endSeasonType, range.endWeekNumber);
  if (startLabel === endLabel) return startLabel;
  return `${startLabel} → ${endLabel}`;
}

// --- Season resolution ---

export function selectCurrentSeason(
  seasons: Season[],
  now: Date = new Date(),
): Season | null {
  if (seasons.length === 0) return null;

  const active = seasons.find(
    (season) => now >= season.startDate && now <= season.endDate,
  );
  if (active) return active;

  const upcoming = seasons
    .filter((season) => season.startDate.getTime() > now.getTime())
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  if (upcoming) return upcoming;

  return [...seasons].sort((a, b) => b.year - a.year)[0] ?? null;
}

// --- Scheduling helpers ---

export function isLeagueInSeason(
  activePhases: Pick<Phase, "seasonType" | "weekNumber">[],
  range: LeagueRange,
): boolean {
  return activePhases.some((phase) => isPhaseInLeagueRange(phase, range));
}

/**
 * BUSINESS_SPEC §3.8: a league's "activation time" for a given season is
 * `max(league.createdAt, season.startDate)`. Creation-season activation is
 * the moment the league was created; every subsequent season's activation
 * is that season's start date.
 */
export function leagueActivationTime(
  leagueCreatedAt: Date,
  seasonStartDate: Date,
): Date {
  return leagueCreatedAt.getTime() > seasonStartDate.getTime()
    ? leagueCreatedAt
    : seasonStartDate;
}

/**
 * BUSINESS_SPEC §3.8: the league's "start phase" is the earliest phase in
 * the league's range whose `pickLockTime` is strictly after the league's
 * activation time. Returns null when every in-range pick lock has already
 * fired for the season.
 */
export function selectLeagueStartPhase(
  phases: Phase[],
  range: LeagueRange,
  activationTime: Date,
): Phase | null {
  return (
    phases
      .filter(
        (p) =>
          isPhaseInLeagueRange(p, range) &&
          p.pickLockTime.getTime() > activationTime.getTime(),
      )
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null
  );
}

export function hasLeagueStartLockPassed(
  phases: Phase[],
  range: LeagueRange,
  activationTime: Date,
  now: Date,
): boolean {
  const start = selectLeagueStartPhase(phases, range, activationTime);
  if (!start) return true;
  return now.getTime() >= start.pickLockTime.getTime();
}

// --- Season state ---

export type LeagueSeasonState = "upcoming" | "in_progress" | "complete";

export function getLeagueSeasonState(
  phases: Phase[],
  range: LeagueRange,
  now: Date,
): LeagueSeasonState {
  const relevant = phases.filter((p) => isPhaseInLeagueRange(p, range));
  if (relevant.length === 0) return "upcoming";
  const earliestStart = Math.min(...relevant.map((p) => p.startDate.getTime()));
  const latestEnd = Math.max(...relevant.map((p) => p.endDate.getTime()));
  if (now.getTime() < earliestStart) return "upcoming";
  if (now.getTime() >= latestEnd) return "complete";
  return "in_progress";
}
