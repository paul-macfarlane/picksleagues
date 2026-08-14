import { SPORT } from "@picksleagues/schemas";
import { useAdminSeasons } from "@/api/admin";

/**
 * The season/week selection chain shared by the admin browsers that scope to
 * a week (games, stat contexts). URL-driven and fallback-resolved in one
 * place: a week identifies its own season (an inbound link needs only
 * `weekId`); `seasonId` covers "season chosen, no week yet"; absent both, the
 * newest season's *current* week (server-resolved, FB-11 — defaulting to
 * week 1 had operators editing a week the clock had long left).
 */
export function useAdminSeasonWeekSelection(seasonId?: string, weekId?: string) {
  const seasons = useAdminSeasons(SPORT.NFL);
  const all = seasons.data?.seasons ?? [];
  const selectedSeason =
    all.find((season) => season.weeks.some((week) => week.id === weekId)) ??
    all.find((season) => season.id === seasonId) ??
    all[0];
  const effectiveWeekId = weekId ?? selectedSeason?.currentWeekId ?? selectedSeason?.weeks[0]?.id;
  return { seasons, all, selectedSeason, effectiveWeekId };
}

/**
 * One label string for both the closed trigger and the open list — a selected
 * provisional season must stay readable as provisional once the list closes.
 */
export function seasonLabel(season: { year: number; provisional: boolean }): string {
  return `${season.year}${season.provisional ? " (provisional)" : ""}`;
}
