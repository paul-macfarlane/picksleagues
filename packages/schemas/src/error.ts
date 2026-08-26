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
  MODE_UNAVAILABLE: "mode_unavailable",
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
  MAX_MEMBERS_BELOW_MEMBER_COUNT: "max_members_below_member_count",
  SCENARIO_NOT_FOUND: "scenario_not_found",
  FIXTURE_NOT_FOUND: "fixture_not_found",
  WEEK_NOT_FOUND: "week_not_found",
  WEEK_HAS_NO_GAMES: "week_has_no_games",
  SEASON_NOT_AVAILABLE: "season_not_available",
  WRONG_LEAGUE_MODE: "wrong_league_mode",
  WEEK_OUT_OF_RANGE: "week_out_of_range",
  // Distinct from WEEK_OUT_OF_RANGE on purpose: that week is never part of the
  // league's season; this one is, but sits beyond the member's pick window —
  // ahead of the current week, and not yet unlocked by the current week
  // resolving (spec §Game Mode 1/2 — Pick window; ADR-0036).
  WEEK_NOT_OPEN: "week_not_open",
  GAME_NOT_IN_WEEK: "game_not_in_week",
  GAME_NOT_PICKABLE: "game_not_pickable",
  DUPLICATE_PICK: "duplicate_pick",
  // A submission must be exactly the week's required size, so these two are
  // exact mirrors: TOO_MANY_PICKS refuses a set larger than the week allows,
  // PICK_SET_INCOMPLETE one smaller. ALREADY_SUBMITTED is the different
  // refusal — a set of any size, from a member who already holds picks for the
  // week and gets only one submission (ADR-0018).
  TOO_MANY_PICKS: "too_many_picks",
  PICK_SET_INCOMPLETE: "pick_set_incomplete",
  ALREADY_SUBMITTED: "already_submitted",
  // Adjacent and easy to confuse: PICK_LOCKED refuses a *pick mutation* whose
  // game has kicked off; PICKS_LOCKED refuses a *settings change* that would
  // discard picks which have already locked.
  PICK_LOCKED: "pick_locked",
  PICKS_LOCKED: "picks_locked",
  SPREAD_STALE: "spread_stale",
  SPREAD_UNAVAILABLE: "spread_unavailable",
  // Marking a member paid in a league whose current instance has no dues
  // amount set (ADR-0045) — the mark would be invisible on every surface, so
  // it's a conflict, not a silent latent write.
  DUES_NOT_ENABLED: "dues_not_enabled",
  // Survivor's three own refusals (spec §Game Mode 2). The rest of its
  // vocabulary — locking, spreads, week range, league mode — is the shared set
  // above; a mode-specific synonym for any of them would just make the same
  // failure read differently depending on which league the member is in.
  MEMBER_ELIMINATED: "member_eliminated",
  TEAM_CONSUMED: "team_consumed",
  TEAM_NOT_IN_GAME: "team_not_in_game",
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

/**
 * Shared error envelope for every non-2xx API response (validation failures,
 * auth failures, conflicts) — one shape the SPA's error handling can rely on.
 */
export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
  })
  .openapi("ErrorResponse");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
