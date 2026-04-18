import type { SeasonFormat } from "@/lib/db/schema/leagues";
import type { Phase, Season, SeasonType } from "@/lib/db/schema/sports";

export function seasonFormatToSeasonTypes(format: SeasonFormat): SeasonType[] {
  switch (format) {
    case "regular_season":
      return ["regular"];
    case "postseason":
      return ["postseason"];
    case "full_season":
      return ["regular", "postseason"];
  }
}

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

export function isLeagueInSeason(
  activePhases: Pick<Phase, "seasonType">[],
  format: SeasonFormat,
): boolean {
  const allowedTypes = new Set(seasonFormatToSeasonTypes(format));
  return activePhases.some((phase) => allowedTypes.has(phase.seasonType));
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
 * the league's format whose `pickLockTime` is strictly after the league's
 * activation time. Returns null when every format-relevant pick lock has
 * already fired for the season — in that case the league can't be created
 * and any existing league treats the season as closed.
 */
export function selectLeagueStartPhase(
  phases: Phase[],
  format: SeasonFormat,
  activationTime: Date,
): Phase | null {
  const allowedTypes = new Set(seasonFormatToSeasonTypes(format));
  return (
    phases
      .filter(
        (p) =>
          allowedTypes.has(p.seasonType) &&
          p.pickLockTime.getTime() > activationTime.getTime(),
      )
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null
  );
}

/**
 * BUSINESS_SPEC §3.8: true once the league has passed its own start lock.
 * Joining, inviting, creating, and structural edits all freeze at this
 * moment. When there's no eligible start phase (format is closed for the
 * season), we treat the league as locked — no upcoming pick lock means no
 * window to act in.
 */
export function hasLeagueStartLockPassed(
  phases: Phase[],
  format: SeasonFormat,
  activationTime: Date,
  now: Date,
): boolean {
  const start = selectLeagueStartPhase(phases, format, activationTime);
  if (!start) return true;
  return now.getTime() >= start.pickLockTime.getTime();
}

export type LeagueSeasonState = "upcoming" | "in_progress" | "complete";

/**
 * Takes every phase for the league's current season (regardless of whether
 * they're active right now) and compares them against `now`. Filters by
 * `format` so a Regular Season league ignores postseason phases, etc.
 */
export function getLeagueSeasonState(
  phases: Phase[],
  format: SeasonFormat,
  now: Date,
): LeagueSeasonState {
  const allowedTypes = new Set(seasonFormatToSeasonTypes(format));
  const relevant = phases.filter((p) => allowedTypes.has(p.seasonType));
  if (relevant.length === 0) {
    // Nothing synced yet for this format — treat as upcoming; the UI will
    // flip once phases land.
    return "upcoming";
  }
  const earliestStart = Math.min(...relevant.map((p) => p.startDate.getTime()));
  const latestEnd = Math.max(...relevant.map((p) => p.endDate.getTime()));
  if (now.getTime() < earliestStart) return "upcoming";
  if (now.getTime() >= latestEnd) return "complete";
  return "in_progress";
}
