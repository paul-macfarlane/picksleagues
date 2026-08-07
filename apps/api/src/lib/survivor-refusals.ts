import { ERROR_CODE, type ErrorResponse } from "@picksleagues/schemas";
import type { SurvivorRefusal } from "../services/survivor/picks";

/**
 * One mapping from a Survivor service refusal to its wire shape, shared by
 * every handler that can emit one so they can't disagree about a code or a
 * status. Lives here rather than in the route file because the same
 * league-level refusals are mapped by more than one route — the pick endpoints
 * and, once it lands, the survivor board — which is the condition the
 * engineering rules name for extracting the map.
 *
 * **Every reason Pick'em also names carries Pick'em's status.** Two modes
 * disagreeing about what `wrong_league_mode` or `pick_locked` means on the wire
 * is a bug nothing can catch for us, since the two maps are separate objects
 * over separate unions (see `lib/pickem-refusals.ts`).
 *
 * The status is looked up per reason rather than returned as a widened union,
 * so a handler that can only produce read refusals is typed as only producing
 * their statuses. Both maps are keyed by `SurvivorRefusal`, so adding a reason
 * fails to compile until it is given a code, a message, and a status.
 */
const REFUSAL_STATUS = {
  league_not_found: 404,
  wrong_league_mode: 400,
  league_concluded: 409,
  week_out_of_range: 400,
  game_not_in_week: 400,
  game_not_pickable: 409,
  team_not_in_game: 409,
  team_consumed: 409,
  member_eliminated: 409,
  pick_locked: 409,
  spread_stale: 409,
  spread_unavailable: 409,
} as const satisfies Record<SurvivorRefusal, 400 | 404 | 409>;

const REFUSAL_BODY = {
  league_not_found: { error: ERROR_CODE.LEAGUE_NOT_FOUND, message: "League not found." },
  wrong_league_mode: {
    error: ERROR_CODE.WRONG_LEAGUE_MODE,
    message: "This league isn't a Survivor league.",
  },
  league_concluded: {
    error: ERROR_CODE.LEAGUE_CONCLUDED,
    message: "This season is over — picks are closed.",
  },
  week_out_of_range: {
    error: ERROR_CODE.WEEK_OUT_OF_RANGE,
    message: "That week isn't part of this league's season.",
  },
  game_not_in_week: {
    error: ERROR_CODE.GAME_NOT_IN_WEEK,
    message: "That game isn't in this week's slate.",
  },
  game_not_pickable: {
    error: ERROR_CODE.GAME_NOT_PICKABLE,
    message: "That game was cancelled — it can't be picked.",
  },
  team_not_in_game: {
    error: ERROR_CODE.TEAM_NOT_IN_GAME,
    message: "That team isn't playing in the game you picked.",
  },
  team_consumed: {
    error: ERROR_CODE.TEAM_CONSUMED,
    message: "You've already used that team this season — pick a different one.",
  },
  member_eliminated: {
    error: ERROR_CODE.MEMBER_ELIMINATED,
    message: "You've been eliminated — your picks are done for this season.",
  },
  pick_locked: {
    error: ERROR_CODE.PICK_LOCKED,
    message: "That game has already kicked off — its pick is locked.",
  },
  spread_stale: {
    error: ERROR_CODE.SPREAD_STALE,
    message: "The spread moved — review the latest number and pick again.",
  },
  spread_unavailable: {
    error: ERROR_CODE.SPREAD_UNAVAILABLE,
    message: "That game has no spread yet — it can't be picked until the line is posted.",
  },
} as const satisfies Record<SurvivorRefusal, ErrorResponse>;

export function survivorRefusal<R extends SurvivorRefusal>(
  reason: R,
): { body: ErrorResponse; status: (typeof REFUSAL_STATUS)[R] } {
  return { body: REFUSAL_BODY[reason], status: REFUSAL_STATUS[reason] };
}
