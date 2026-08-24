import { ERROR_CODE, type ErrorResponse } from "@picksleagues/schemas";

/**
 * One status per league-surface refusal, shared by every handler in
 * `routes/leagues.ts`, `routes/members.ts`, and `routes/invites.ts` that can
 * emit one — the commissioner gate (not found / not commissioner / started)
 * is mapped from all three files, and a status that drifted between them
 * would make the same refusal read as a different failure per endpoint.
 *
 * Status only, not message: unlike the Pick'em refusals, the message here is
 * per action ("can't be deleted after it has started" vs "membership is
 * frozen"), so each handler keeps a message table keyed by its own reason
 * union (`satisfies Record<…, string>`) and TypeScript still fails the build
 * when a service grows a reason the handler hasn't worded.
 */
const LEAGUE_REFUSAL_STATUS = {
  [ERROR_CODE.LEAGUE_NOT_FOUND]: 404,
  [ERROR_CODE.MEMBER_NOT_FOUND]: 404,
  [ERROR_CODE.INVITE_NOT_FOUND]: 404,
  [ERROR_CODE.NOT_COMMISSIONER]: 403,
  [ERROR_CODE.VALIDATION]: 400,
  [ERROR_CODE.CANNOT_KICK_SELF]: 400,
  [ERROR_CODE.LEAGUE_STARTED]: 409,
  [ERROR_CODE.MODE_UNAVAILABLE]: 409,
  [ERROR_CODE.NO_ACTIVE_SEASON]: 409,
  [ERROR_CODE.START_WEEK_PASSED]: 409,
  [ERROR_CODE.MAX_MEMBERS_BELOW_MEMBER_COUNT]: 409,
  [ERROR_CODE.PICKS_LOCKED]: 409,
  [ERROR_CODE.NO_NEWER_SEASON]: 409,
  [ERROR_CODE.DUES_NOT_ENABLED]: 409,
  [ERROR_CODE.SOLE_MEMBER]: 409,
  [ERROR_CODE.LAST_COMMISSIONER]: 409,
  [ERROR_CODE.CAP_EXCEEDED]: 409,
} as const;

export type LeagueRefusal = keyof typeof LEAGUE_REFUSAL_STATUS;

export function leagueRefusal<R extends LeagueRefusal>(
  reason: R,
  message: string,
): { body: ErrorResponse; status: (typeof LEAGUE_REFUSAL_STATUS)[R] } {
  return { body: { error: reason, message }, status: LEAGUE_REFUSAL_STATUS[reason] };
}
