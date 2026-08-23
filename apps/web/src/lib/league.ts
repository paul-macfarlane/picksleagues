import {
  canPerformLeagueAction,
  LEAGUE_MODE,
  MEMBER_ROLE,
  PICK_TYPE,
  type LeagueAction,
  type LeagueMode,
  type LeagueResponse,
  type MemberRole,
  type PickType,
} from "@picksleagues/schemas";
import { formatDateTime } from "@/lib/format";

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

// One home for the pickType→human-label mapping, consumed by the settings
// fieldsets and the discovery card's pre-join settings summary.
const PICK_TYPE_LABELS: Record<PickType, string> = {
  [PICK_TYPE.STRAIGHT_UP]: "Straight Up",
  [PICK_TYPE.AGAINST_THE_SPREAD]: "Against the Spread",
};

export function pickTypeLabel(pickType: PickType): string {
  return PICK_TYPE_LABELS[pickType];
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
 * The one timing line a league surface prints (dashboard card, league header).
 * A league that hasn't kicked off is described by when it will; one that has is
 * described by where it is, because a card still announcing a start date the
 * season is a month past is the tense bug this fixes (FB-28).
 *
 * `now` must come from `useAppNow()`, never a local `Date`: the sighting was a
 * card reading "Starts 9/4/25" at a simulated 10/2, and a browser-clock
 * comparison would be wrong in exactly the environment that surfaced it. Same
 * `>=`-is-started boundary as `leagueHasStarted`, so no two lines on one screen
 * can disagree about whether a league is under way.
 *
 * `currentWeekLabel` is absent on surfaces whose DTO doesn't carry one, and
 * null when a season's weeks aren't ingested; both fall back to the past-tense
 * start date rather than an empty line.
 */
export function leagueTimingLine(
  league: { startsAt: string | null; currentWeekLabel?: string | null },
  now: Date,
): string {
  if (league.startsAt === null) return "Start date TBD";
  if (now.getTime() < new Date(league.startsAt).getTime()) {
    return `Starts ${formatDateTime(league.startsAt)}`;
  }
  return league.currentWeekLabel ?? `Started ${formatDateTime(league.startsAt)}`;
}

/**
 * Mirrors the server's `last_commissioner` boundary
 * (apps/api/src/services/members.ts): a league must keep ≥1 commissioner
 * (ADR-0004), so when this is true the sole commissioner's own step-down or
 * leave can only be refused. The server's refusal stays the actual
 * enforcement; this is only the disable-with-reason hint.
 */
export function hasSoleCommissioner(league: LeagueResponse): boolean {
  return league.members.filter((member) => member.role === MEMBER_ROLE.COMMISSIONER).length === 1;
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

/**
 * Whether a pathname belongs to the "Leagues" primary-nav entry: the hub at
 * `/` plus everything under `/leagues` (a league, `/leagues/new`). Both the
 * header nav and the phone tab bar light the entry from this, so the two
 * can't disagree about where a member is.
 */
export function isLeaguesSubtree(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/leagues");
}
