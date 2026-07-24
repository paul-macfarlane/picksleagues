import { MEMBER_ROLE, type MemberRole } from "./member-role";

/**
 * Every league-scoped action a member can attempt — the single home for the
 * spec §Commissioner Powers table (plus leaving, spec §Membership), so the
 * API's guards and the UI's section gating consume one matrix instead of
 * restating it per call site. Pick visibility is deliberately absent: it's
 * enforced in the query layer (engineering rules §Time & locking), never as
 * a capability check.
 */
export const LEAGUE_ACTION = {
  EDIT_NAME: "edit_name",
  EDIT_VISIBILITY: "edit_visibility",
  EDIT_SETTINGS: "edit_settings",
  DELETE_LEAGUE: "delete_league",
  KICK_MEMBER: "kick_member",
  PROMOTE_MEMBER: "promote_member",
  DEMOTE_COMMISSIONER: "demote_commissioner",
  MANAGE_INVITES: "manage_invites",
  LEAVE_LEAGUE: "leave_league",
} as const;

export type LeagueAction = (typeof LEAGUE_ACTION)[keyof typeof LEAGUE_ACTION];

/**
 * The two axes of spec §Commissioner Powers: who may act, and in which
 * window. Windows derive from game timestamps + the injected Clock (arch
 * §Locking Model) — this table only says whether an action HAS a window,
 * never computes one.
 */
const LEAGUE_ACTION_RULES: Record<
  LeagueAction,
  { commissionerOnly: boolean; preStartOnly: boolean }
> = {
  [LEAGUE_ACTION.EDIT_NAME]: { commissionerOnly: true, preStartOnly: false },
  [LEAGUE_ACTION.EDIT_VISIBILITY]: { commissionerOnly: true, preStartOnly: true },
  [LEAGUE_ACTION.EDIT_SETTINGS]: { commissionerOnly: true, preStartOnly: true },
  [LEAGUE_ACTION.DELETE_LEAGUE]: { commissionerOnly: true, preStartOnly: true },
  [LEAGUE_ACTION.KICK_MEMBER]: { commissionerOnly: true, preStartOnly: true },
  [LEAGUE_ACTION.PROMOTE_MEMBER]: { commissionerOnly: true, preStartOnly: false },
  [LEAGUE_ACTION.DEMOTE_COMMISSIONER]: { commissionerOnly: true, preStartOnly: false },
  [LEAGUE_ACTION.MANAGE_INVITES]: { commissionerOnly: true, preStartOnly: false },
  // Any member may leave, but only pre-start (spec §Membership, ADR-0004).
  [LEAGUE_ACTION.LEAVE_LEAGUE]: { commissionerOnly: false, preStartOnly: true },
};

/** Role axis alone — the API maps its failure to 403 (vs 409 for windows). */
export function leagueActionRequiresCommissioner(action: LeagueAction): boolean {
  return LEAGUE_ACTION_RULES[action].commissionerOnly;
}

/** Window axis alone — the API maps its failure to 409 `league_started`. */
export function leagueActionIsPreStartOnly(action: LeagueAction): boolean {
  return LEAGUE_ACTION_RULES[action].preStartOnly;
}

/**
 * Both axes at once. The UI gates sections with `preStart: true` — showing a
 * control is a role question; whether the window has closed is enforced by
 * the server per request (409 `league_started`), never computed client-side
 * (arch D11: lock state is derived from the server's Clock, and the client
 * has no trustworthy "now").
 */
export function canPerformLeagueAction(
  action: LeagueAction,
  context: { role: MemberRole; preStart: boolean },
): boolean {
  if (leagueActionRequiresCommissioner(action) && context.role !== MEMBER_ROLE.COMMISSIONER) {
    return false;
  }
  if (leagueActionIsPreStartOnly(action) && !context.preStart) {
    return false;
  }
  return true;
}
