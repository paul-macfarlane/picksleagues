import { z } from "@hono/zod-openapi";

/**
 * The complete inventory of wire `error` slugs the API can emit. A const
 * object (not a schema enum) so routes/services reference `ERROR_CODE.*`
 * instead of writing raw slugs — but `ErrorResponseSchema.error` below stays
 * `z.string()`, not `z.enum(ERROR_CODE)`: enumerating every code in the
 * OpenAPI contract would churn the committed spec on every new code, while
 * the string type keeps the contract stable as this set grows.
 */
export const ERROR_CODE = {
  MISCONFIGURED: "misconfigured",
  INTERNAL: "internal",
  UNAUTHENTICATED: "unauthenticated",
  UNAUTHORIZED: "unauthorized",
  NOT_ADMIN: "not_admin",
  VALIDATION: "validation",
  USERNAME_TAKEN: "username_taken",
  LAST_COMMISSIONER: "last_commissioner",
  LEAGUE_NOT_FOUND: "league_not_found",
  GAME_NOT_FOUND: "game_not_found",
  NOT_COMMISSIONER: "not_commissioner",
  MEMBER_NOT_FOUND: "member_not_found",
  INVITE_NOT_FOUND: "invite_not_found",
  INVITE_INVALID: "invite_invalid",
  LEAGUE_STARTED: "league_started",
  START_WEEK_PASSED: "start_week_passed",
  CAP_EXCEEDED: "cap_exceeded",
  NO_ACTIVE_SEASON: "no_active_season",
  NO_NEWER_SEASON: "no_newer_season",
  SOLE_MEMBER: "sole_member",
  CANNOT_KICK_SELF: "cannot_kick_self",
  ALREADY_MEMBER: "already_member",
  LEAGUE_CONCLUDED: "league_concluded",
  JOIN_CLOSED: "join_closed",
  LEAGUE_FULL: "league_full",
  INVITE_REVOKED: "invite_revoked",
  INVITE_EXPIRED: "invite_expired",
  INVITE_EXHAUSTED: "invite_exhausted",
  MAX_MEMBERS_BELOW_MEMBER_COUNT: "max_members_below_member_count",
  SCENARIO_NOT_FOUND: "scenario_not_found",
  FIXTURE_NOT_FOUND: "fixture_not_found",
  WEEK_NOT_FOUND: "week_not_found",
  WEEK_HAS_NO_GAMES: "week_has_no_games",
  SEASON_NOT_AVAILABLE: "season_not_available",
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

// Shared error envelope for every non-2xx API response (validation failures,
// auth failures, conflicts) — one shape the SPA's error handling can rely on.
export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
  })
  .openapi("ErrorResponse");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
