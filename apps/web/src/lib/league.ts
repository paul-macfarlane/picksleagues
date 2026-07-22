import { LEAGUE_MODE, type LeagueMode } from "@picksleagues/schemas";

// One home for the mode→human-label mapping (engineering rule on derived
// display values) — consumed by the create-league mode picker, the invite
// preview, and the dashboard's league list.
const LEAGUE_MODE_LABELS: Record<LeagueMode, string> = {
  [LEAGUE_MODE.PICKEM]: "NFL Pick'em",
  [LEAGUE_MODE.ELIMINATION]: "NFL Elimination",
  [LEAGUE_MODE.MARCH_MADNESS]: "March Madness Pool",
};

export function leagueModeLabel(mode: LeagueMode): string {
  return LEAGUE_MODE_LABELS[mode];
}
