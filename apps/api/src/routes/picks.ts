import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ERROR_CODE,
  ErrorResponseSchema,
  LeagueStandingsResponseSchema,
  LeagueWeeksResponseSchema,
  PickemWeekPicksResponseSchema,
  RepickRequestSchema,
  SubmitPickemPicksRequestSchema,
  WeekSlateResponseSchema,
  type ErrorResponse,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import {
  errorResponse,
  LEAGUE_NOT_FOUND_404,
  MISCONFIGURED_500,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import { getWeekSlate } from "../services/picks/slate";
import { listLeagueWeeks } from "../services/picks/weeks";
import { getLeagueStandings } from "../services/picks/standings";
import {
  getPickemWeekPicks,
  repickPickemPick,
  submitPickemPicks,
  type PickemRefusal,
} from "../services/picks/pickem";

const WeekIdParamsSchema = z.object({ weekId: z.uuid() });
const LeagueWeekParamsSchema = z.object({ leagueId: z.uuid(), weekId: z.uuid() });

/**
 * One mapping from a Pick'em service refusal to its wire shape, shared by the
 * read and write handlers so the two can't disagree about a code or a status.
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
} as const satisfies Record<PickemRefusal, 400 | 404 | 409>;

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
} as const satisfies Record<PickemRefusal, ErrorResponse>;

function pickemRefusal<R extends PickemRefusal>(
  reason: R,
): { body: ErrorResponse; status: (typeof REFUSAL_STATUS)[R] } {
  return { body: REFUSAL_BODY[reason], status: REFUSAL_STATUS[reason] };
}

const getWeekGames = createRoute({
  method: "get",
  path: "/weeks/{weekId}/games",
  operationId: "getWeekSlate",
  summary: "A week's game slate with current spreads and derived lock state",
  request: { params: WeekIdParamsSchema },
  responses: {
    200: {
      description: "The week and its games, override-resolved, ordered by kickoff",
      content: { "application/json": { schema: WeekSlateResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    404: errorResponse("No such week"),
    500: MISCONFIGURED_500,
  },
});

const getLeagueStandingsRoute = createRoute({
  method: "get",
  path: "/leagues/{leagueId}/standings",
  operationId: "getLeagueStandings",
  summary: "The league's standings — season-cumulative by default, weekly with ?week=",
  request: {
    params: z.object({ leagueId: z.uuid() }),
    // Absent selects the season board. The two leaderboards are one table at
    // different scopes (spec §Standings), so they are one endpoint.
    query: z.object({ week: z.uuid().optional() }),
  },
  responses: {
    200: {
      description:
        "Rows in rank order, with the tiebreaker differential and the time settlement last wrote the board",
      content: { "application/json": { schema: LeagueStandingsResponseSchema } },
    },
    400: errorResponse(
      "A request param failed its format rule, or `week` is not a week of this league's season (week_out_of_range)",
    ),
    401: UNAUTHENTICATED_401,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const getLeagueWeeks = createRoute({
  method: "get",
  path: "/leagues/{leagueId}/weeks",
  operationId: "listLeagueWeeks",
  summary: "The weeks this league plays, clipped to its configured start/end week",
  request: { params: z.object({ leagueId: z.uuid() }) },
  responses: {
    200: {
      description: "Weeks in season order, plus the week a member lands on by default",
      content: { "application/json": { schema: LeagueWeeksResponseSchema } },
    },
    400: errorResponse("Not a Pick'em league (wrong_league_mode)"),
    401: UNAUTHENTICATED_401,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const getLeagueWeekPicks = createRoute({
  method: "get",
  path: "/leagues/{leagueId}/picks/week/{weekId}",
  operationId: "getPickemWeekPicks",
  summary: "Every member's picks for a week, filtered by kickoff visibility",
  request: { params: LeagueWeekParamsSchema },
  responses: {
    200: {
      description:
        "One entry per member. The caller sees their own picks in full; another member's appear only once that game has kicked off, with `hiddenPickCount` reporting the rest",
      content: { "application/json": { schema: PickemWeekPicksResponseSchema } },
    },
    400: errorResponse(
      "Not a Pick'em league (wrong_league_mode), or the week is outside this league's season or configured start/end range (week_out_of_range)",
    ),
    401: UNAUTHENTICATED_401,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const putLeagueWeekPicks = createRoute({
  method: "put",
  path: "/leagues/{leagueId}/picks/week/{weekId}",
  operationId: "submitPickemPicks",
  summary: "Replace the caller's unstarted picks for a week",
  request: {
    params: LeagueWeekParamsSchema,
    body: { content: { "application/json": { schema: SubmitPickemPicksRequestSchema } } },
  },
  responses: {
    200: {
      description:
        "Picks saved; the week's picks are returned as the read endpoint would serve them",
      content: { "application/json": { schema: PickemWeekPicksResponseSchema } },
    },
    400: errorResponse(
      "Not a Pick'em league (wrong_league_mode), week outside the league's range (week_out_of_range), a game not in this week's slate (game_not_in_week), the same game picked twice (duplicate_pick), or more picks than the week allows (too_many_picks)",
    ),
    401: UNAUTHENTICATED_401,
    404: LEAGUE_NOT_FOUND_404,
    409: errorResponse(
      "A submitted game has already kicked off (pick_locked — locked picks are immutable and must be omitted), the game was cancelled or moved out of the week (game_not_pickable), the accepted spread is no longer current (spread_stale — refetch the slate and re-prompt), the game has no spread posted yet (spread_unavailable — nothing to accept until the odds sync lands), or the season has concluded (league_concluded)",
    ),
    500: MISCONFIGURED_500,
  },
});

const postRepick = createRoute({
  method: "post",
  path: "/leagues/{leagueId}/picks/week/{weekId}/repick",
  operationId: "repickPickemPick",
  summary: "Substitute a pick whose game was cancelled or moved out of the week",
  request: {
    params: LeagueWeekParamsSchema,
    body: { content: { "application/json": { schema: RepickRequestSchema } } },
  },
  responses: {
    200: {
      description:
        "Substitution saved; the week's picks are returned as the read endpoint serves them",
      content: { "application/json": { schema: PickemWeekPicksResponseSchema } },
    },
    400: errorResponse(
      "Not a Pick'em league (wrong_league_mode), week outside the league's range (week_out_of_range), the replacement isn't in this week's slate (game_not_in_week), or the caller already holds it (duplicate_pick)",
    ),
    401: UNAUTHENTICATED_401,
    404: errorResponse(
      "No such league or the caller isn't a member (league_not_found), or the pick being replaced doesn't exist (pick_not_found)",
    ),
    409: errorResponse(
      "The replaced pick's game is still playable, so it earns no substitution (pick_not_replaceable), the replacement already kicked off (pick_locked) or is itself unplayable (game_not_pickable), its spread moved (spread_stale) or is not posted yet (spread_unavailable), or the season has concluded (league_concluded)",
    ),
    500: MISCONFIGURED_500,
  },
});

export function pickRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/weeks/*", requireSession(deps));
  app.use("/weeks/*", requireDbAndClock(deps));
  // Scoped to this file's own routes rather than all of `/leagues/*`, matching
  // members.ts — a broader pattern would make the extra session lookup a
  // function of which route file mounts last.
  for (const path of [
    "/leagues/:leagueId/picks/*",
    "/leagues/:leagueId/weeks",
    "/leagues/:leagueId/standings",
  ]) {
    app.use(path, requireSession(deps));
    app.use(path, requireDbAndClock(deps));
  }

  app.openapi(getWeekGames, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const { weekId } = c.req.valid("param");

    const slate = await getWeekSlate(db, clock, weekId);
    if (!slate) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.WEEK_NOT_FOUND,
          message: "Week not found.",
        }),
        404,
      );
    }

    return c.json(slate, 200);
  });

  app.openapi(getLeagueStandingsRoute, async (c) => {
    const db = c.get("db");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");
    const { week } = c.req.valid("query");

    const result = await getLeagueStandings(db, leagueId, sessionUser.id, week);
    if (!result.ok) {
      const { body, status } = pickemRefusal(result.reason);
      return c.json(ErrorResponseSchema.parse(body), status);
    }

    return c.json(result.value, 200);
  });

  app.openapi(getLeagueWeeks, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");

    const result = await listLeagueWeeks(db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      const { body, status } = pickemRefusal(result.reason);
      return c.json(ErrorResponseSchema.parse(body), status);
    }

    return c.json(result.value, 200);
  });

  app.openapi(getLeagueWeekPicks, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId, weekId } = c.req.valid("param");

    const result = await getPickemWeekPicks(db, clock, leagueId, weekId, sessionUser.id);
    if (!result.ok) {
      const { body, status } = pickemRefusal(result.reason);
      return c.json(ErrorResponseSchema.parse(body), status);
    }

    return c.json(result.value, 200);
  });

  app.openapi(postRepick, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId, weekId } = c.req.valid("param");
    const request = c.req.valid("json");

    const result = await repickPickemPick(db, clock, leagueId, weekId, sessionUser.id, request);
    if (!result.ok) {
      const { body, status } = pickemRefusal(result.reason);
      return c.json(ErrorResponseSchema.parse(body), status);
    }

    return c.json(result.value, 200);
  });

  app.openapi(putLeagueWeekPicks, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId, weekId } = c.req.valid("param");
    const { picks } = c.req.valid("json");

    const result = await submitPickemPicks(db, clock, leagueId, weekId, sessionUser.id, picks);
    if (!result.ok) {
      const { body, status } = pickemRefusal(result.reason);
      return c.json(ErrorResponseSchema.parse(body), status);
    }

    return c.json(result.value, 200);
  });

  return app;
}
