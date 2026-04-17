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
