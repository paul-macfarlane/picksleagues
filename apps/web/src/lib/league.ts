import { LEAGUE_MODE, MEMBER_ROLE, type LeagueMode, type MemberRole } from "@picksleagues/schemas";

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

// One home for the role→human-label mapping, consumed by the league home
// member list and its per-row commissioner actions.
const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  [MEMBER_ROLE.COMMISSIONER]: "Commissioner",
  [MEMBER_ROLE.MEMBER]: "Member",
};

export function memberRoleLabel(role: MemberRole): string {
  return MEMBER_ROLE_LABELS[role];
}
