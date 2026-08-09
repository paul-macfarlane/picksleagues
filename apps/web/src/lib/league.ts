import {
  canPerformLeagueAction,
  LEAGUE_MODE,
  MEMBER_ROLE,
  type LeagueAction,
  type LeagueMode,
  type LeagueResponse,
  type MemberRole,
} from "@picksleagues/schemas";

// One home for the mode→human-label mapping (engineering rule on derived
// display values) — consumed by the create-league mode picker, the invite
// preview, and the dashboard's league list.
const LEAGUE_MODE_LABELS: Record<LeagueMode, string> = {
  [LEAGUE_MODE.PICKEM]: "NFL Pick'em",
  [LEAGUE_MODE.SURVIVOR]: "NFL Survivor",
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

// One home for the mode→rules-page mapping (LNCH-1), consumed by the league
// header and both modes' pick surfaces.
const LEAGUE_MODE_RULES_PATHS: Record<LeagueMode, string | null> = {
  [LEAGUE_MODE.PICKEM]: "/rules/pickem",
  [LEAGUE_MODE.SURVIVOR]: "/rules/survivor",
  [LEAGUE_MODE.MARCH_MADNESS]: null,
};

/**
 * Null means the mode has no rules guide yet (March Madness until epic 07) —
 * callers must render no link rather than a path that 404s.
 */
export function leagueModeRulesPath(mode: LeagueMode): string | null {
  return LEAGUE_MODE_RULES_PATHS[mode];
}

/**
 * Mirrors the server's `isPreStart` boundary exactly
 * (apps/api/src/services/leagues/start.ts): `startsAt === null` means the
 * start isn't derivable yet (not started), and `now >= startsAt` — not `>` —
 * is started. Kept hook-free (no `useAppNow()` here) so callers read the
 * clock once per component and pass `now` down; the server's 409 stays the
 * actual enforcement, this is only the disable-with-reason hint.
 */
export function leagueHasStarted(league: LeagueResponse, now: Date): boolean {
  return league.startsAt !== null && now.getTime() >= new Date(league.startsAt).getTime();
}

/**
 * Section visibility runs on the LEAGUE_ACTION matrix's role axis; the window
 * axis is `leagueHasStarted` against the caller's `now` (arch D11: the
 * server's Clock is the only trustworthy "now", so callers must pass one
 * derived from `useAppNow()`, never a local `Date`).
 */
export function canActOnLeague(league: LeagueResponse, action: LeagueAction, now: Date) {
  return canPerformLeagueAction(action, {
    role: league.myRole,
    preStart: !leagueHasStarted(league, now),
  });
}
