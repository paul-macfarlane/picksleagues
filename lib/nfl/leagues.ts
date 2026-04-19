import type { League } from "@/lib/db/schema/leagues";
import type { Event, Phase, Season, SeasonType } from "@/lib/db/schema/sports";

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

/**
 * BUSINESS_SPEC §3.8: the league's "start phase" for a given season is the
 * phase matching the league's configured start tuple. The commissioner
 * picks the start week explicitly (§3.1), so there's no date arithmetic —
 * the start phase is whichever synced phase matches `(startSeasonType,
 * startWeekNumber)`. Returns null when that phase isn't present in the
 * supplied list (e.g. the season's phases haven't synced yet).
 */
export function selectLeagueStartPhase(
  phases: Phase[],
  range: LeagueRange,
): Phase | null {
  return (
    phases.find(
      (p) =>
        p.seasonType === range.startSeasonType &&
        p.weekNumber === range.startWeekNumber,
    ) ?? null
  );
}

export function hasLeagueStartLockPassed(
  phases: Phase[],
  range: LeagueRange,
  now: Date,
): boolean {
  const start = selectLeagueStartPhase(phases, range);
  if (!start) return false;
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

// --- Phase-view resolution (shared by My Picks / League Picks pages) ---

export type PhaseViewResolution =
  | {
      kind: "ok";
      phasesInRange: Phase[];
      selectedPhase: Phase;
      prevPhase: Phase | null;
      nextPhase: Phase | null;
    }
  | { kind: "no-phases-in-range" };

/**
 * Shared phase-resolution for any page rendering "pick view for one phase
 * in this league" — filters the season's phases to the league's range,
 * honors `?phase=<id>` when it points at an in-range phase, falls back to
 * `selectLeagueCurrentPhase`, and computes prev/next neighbors. Returns a
 * discriminated result so the caller can render a distinct empty state
 * when the league range has no synced phases.
 */
export function resolvePhaseView(params: {
  league: LeagueRange;
  allPhases: Phase[];
  requestedPhaseId: string | null;
  now: Date;
}): PhaseViewResolution {
  const phasesInRange = params.allPhases
    .filter((p) => isPhaseInLeagueRange(p, params.league))
    .sort(comparePhasesByOrdinal);

  const requestedPhase = params.requestedPhaseId
    ? (phasesInRange.find((p) => p.id === params.requestedPhaseId) ?? null)
    : null;
  const selectedPhase =
    requestedPhase ??
    selectLeagueCurrentPhase(params.allPhases, params.league, params.now);

  if (!selectedPhase) return { kind: "no-phases-in-range" };

  const currentIndex = phasesInRange.findIndex(
    (p) => p.id === selectedPhase.id,
  );
  const prevPhase = currentIndex > 0 ? phasesInRange[currentIndex - 1] : null;
  const nextPhase =
    currentIndex >= 0 && currentIndex < phasesInRange.length - 1
      ? phasesInRange[currentIndex + 1]
      : null;

  return { kind: "ok", phasesInRange, selectedPhase, prevPhase, nextPhase };
}

// --- Phase resolution for the picks view ---

/**
 * BUSINESS_SPEC §6.3: picks views default to the currently-active phase;
 * when nothing is active we show the nearest upcoming phase, and after the
 * league's season is over we show its final phase.
 *
 * Only phases inside the league's range are considered — a postseason-only
 * league never defaults to a regular-season week.
 */
export function selectLeagueCurrentPhase(
  phases: Phase[],
  range: LeagueRange,
  now: Date,
): Phase | null {
  const relevant = phases.filter((p) => isPhaseInLeagueRange(p, range));
  if (relevant.length === 0) return null;

  const active = relevant.find((p) => now >= p.startDate && now < p.endDate);
  if (active) return active;

  const upcoming = relevant
    .filter((p) => p.startDate.getTime() > now.getTime())
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  if (upcoming) return upcoming;

  return [...relevant].sort(
    (a, b) => b.startDate.getTime() - a.startDate.getTime(),
  )[0];
}

// --- Standings season selection ---

/**
 * BUSINESS_SPEC §3.5 / §12.4: the Standings tab shows the current season
 * by default and supports navigating to prior seasons. Resolution order:
 * explicit `?season` param (if present in the historical list) → the
 * current season (if the league has standings for it) → the most recent
 * historical season with standings → the current season as a last resort
 * so new leagues render an empty-standings state with the right year.
 */
export function selectStandingsSeason({
  seasonsWithStandings,
  currentSeason,
  requestedSeasonId,
}: {
  seasonsWithStandings: Season[];
  currentSeason: Season | null;
  requestedSeasonId: string | null;
}): Season | null {
  if (requestedSeasonId) {
    const requested = seasonsWithStandings.find(
      (s) => s.id === requestedSeasonId,
    );
    if (requested) return requested;
  }
  if (currentSeason) {
    const currentWithStandings = seasonsWithStandings.find(
      (s) => s.id === currentSeason.id,
    );
    if (currentWithStandings) return currentWithStandings;
  }
  const mostRecentHistorical = [...seasonsWithStandings].sort(
    (a, b) => b.year - a.year,
  )[0];
  if (mostRecentHistorical) return mostRecentHistorical;
  return currentSeason;
}

// --- Pick lock gates ---

export function isPhaseLocked(
  phase: Pick<Phase, "pickLockTime">,
  now: Date,
): boolean {
  return now.getTime() >= phase.pickLockTime.getTime();
}

/**
 * BUSINESS_SPEC §7.1 / §7.2: picks are locked when either the phase's pick
 * lock time has passed OR the specific game has already kicked off. The
 * per-event kickoff gate fires ahead of the phase-wide lock for early
 * games (e.g. Thursday Night Football in an NFL week).
 */
export function isPickLocked(
  phase: Pick<Phase, "pickLockTime">,
  event: Pick<Event, "startTime">,
  now: Date,
): boolean {
  return (
    isPhaseLocked(phase, now) || now.getTime() >= event.startTime.getTime()
  );
}
