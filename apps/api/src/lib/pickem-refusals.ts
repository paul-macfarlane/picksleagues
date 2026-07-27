import { ERROR_CODE, type ErrorResponse } from "@picksleagues/schemas";
import type { PickemRefusal } from "../services/pickem/picks";

/**
 * One mapping from a Pick'em service refusal to its wire shape, shared by every
 * handler that can emit one so they can't disagree about a code or a status.
 * Lives here rather than in a route file because the routes that produce these
 * refusals are split across `routes/pickem.ts` and `routes/weeks.ts` (the week
 * list is a mode-agnostic surface behind a Pick'em-only gate).
 *
 * The status is looked up per reason rather than returned as a widened union,
 * so a handler that can only produce read refusals is typed as only producing
 * their statuses — the read route never has to declare the write-only 409s.
 * Both maps are keyed by `PickemRefusal`, so adding a reason fails to compile
 * until it is given a code, a message, and a status.
 */
const REFUSAL_STATUS = {
  league_not_found: 404,
  wrong_league_mode: 400,
  league_concluded: 409,
  week_out_of_range: 400,
  game_not_in_week: 400,
  game_not_pickable: 409,
  duplicate_pick: 400,
  too_many_picks: 400,
  pick_locked: 409,
  spread_stale: 409,
  spread_unavailable: 409,
  pick_not_found: 404,
  pick_not_replaceable: 409,
  not_commissioner: 403,
} as const satisfies Record<PickemRefusal, 400 | 403 | 404 | 409>;

const REFUSAL_BODY = {
  league_not_found: { error: ERROR_CODE.LEAGUE_NOT_FOUND, message: "League not found." },
  wrong_league_mode: {
    error: ERROR_CODE.WRONG_LEAGUE_MODE,
    message: "This league isn't a Pick'em league.",
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
    message: "One of those games isn't in this week's slate.",
  },
  game_not_pickable: {
    error: ERROR_CODE.GAME_NOT_PICKABLE,
    message: "That game was cancelled or moved — it can't be picked.",
  },
  duplicate_pick: {
    error: ERROR_CODE.DUPLICATE_PICK,
    message: "You can only pick each game once.",
  },
  too_many_picks: {
    error: ERROR_CODE.TOO_MANY_PICKS,
    message: "That's more picks than this league allows for the week.",
  },
  pick_locked: {
    error: ERROR_CODE.PICK_LOCKED,
    message: "That game has already kicked off — its pick is locked.",
  },
  spread_stale: {
    error: ERROR_CODE.SPREAD_STALE,
    message: "The spreads moved — review the latest numbers and submit again.",
  },
  spread_unavailable: {
    error: ERROR_CODE.SPREAD_UNAVAILABLE,
    message: "That game has no spread yet — it can't be picked until the line is posted.",
  },
  pick_not_found: {
    error: ERROR_CODE.PICK_NOT_FOUND,
    message: "That pick no longer exists.",
  },
  pick_not_replaceable: {
    error: ERROR_CODE.PICK_NOT_REPLACEABLE,
    message:
      "That game wasn't cancelled or moved, so it can't be substituted — edit your picks instead.",
  },
  not_commissioner: {
    error: ERROR_CODE.NOT_COMMISSIONER,
    message: "Only a commissioner can view this.",
  },
} as const satisfies Record<PickemRefusal, ErrorResponse>;

export function pickemRefusal<R extends PickemRefusal>(
  reason: R,
): { body: ErrorResponse; status: (typeof REFUSAL_STATUS)[R] } {
  return { body: REFUSAL_BODY[reason], status: REFUSAL_STATUS[reason] };
}
