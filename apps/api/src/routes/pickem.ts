import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  PickemPickSummarySchema,
  PickemRepickRequestSchema,
  PickemStandingsResponseSchema,
  PickemWeekPicksResponseSchema,
  SubmitPickemPicksRequestSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { pickemRefusal } from "../lib/pickem-refusals";
import {
  errorResponse,
  LEAGUE_NOT_FOUND_404,
  MISCONFIGURED_500,
  NOT_COMMISSIONER_403,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import {
  getPickemPickSummary,
  getPickemWeekPicks,
  repickPickemPick,
  submitPickemPicks,
} from "../services/pickem/picks";
import { getPickemStandings } from "../services/pickem/standings";

const LeagueWeekParamsSchema = z.object({ leagueId: z.uuid(), weekId: z.uuid() });
const LeagueIdParamsSchema = z.object({ leagueId: z.uuid() });

const getPickSummary = createRoute({
  method: "get",
  path: "/leagues/{leagueId}/pickem/pick-summary",
  operationId: "getPickemPickSummary",
  summary:
    "How many picks — and distinct members holding one — sit on the league's current season (commissioner, settings editor only)",
  request: { params: LeagueIdParamsSchema },
  responses: {
    200: {
      description:
        "Pick and distinct-member counts on the league's current season instance — what a settings edit that invalidates picks would destroy",
      content: { "application/json": { schema: PickemPickSummarySchema } },
    },
    400: errorResponse("Not a Pick'em league (wrong_league_mode)"),
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const getStandings = createRoute({
  method: "get",
  path: "/leagues/{leagueId}/pickem/standings",
  operationId: "getPickemStandings",
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
      content: { "application/json": { schema: PickemStandingsResponseSchema } },
    },
    400: errorResponse(
      "A request param failed its format rule, or `week` is not a week of this league's season (week_out_of_range)",
    ),
    401: UNAUTHENTICATED_401,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const getLeagueWeekPicks = createRoute({
  method: "get",
  path: "/leagues/{leagueId}/pickem/weeks/{weekId}/picks",
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
  path: "/leagues/{leagueId}/pickem/weeks/{weekId}/picks",
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
  path: "/leagues/{leagueId}/pickem/weeks/{weekId}/repick",
  operationId: "repickPickemPick",
  summary: "Substitute a pick whose game was cancelled or moved out of the week",
  request: {
    params: LeagueWeekParamsSchema,
    body: { content: { "application/json": { schema: PickemRepickRequestSchema } } },
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

export function pickemRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  // Scoped to this file's own routes rather than all of `/leagues/*`, matching
  // members.ts — a broader pattern would make the extra session lookup a
  // function of which route file mounts last.
  app.use("/leagues/:leagueId/pickem/*", requireSession(deps));
  app.use("/leagues/:leagueId/pickem/*", requireDbAndClock(deps));

  app.openapi(getPickSummary, async (c) => {
    const db = c.get("db");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");

    const result = await getPickemPickSummary(db, leagueId, sessionUser.id);
    if (!result.ok) {
      const { body, status } = pickemRefusal(result.reason);
      return c.json(ErrorResponseSchema.parse(body), status);
    }

    return c.json(result.value, 200);
  });

  app.openapi(getStandings, async (c) => {
    const db = c.get("db");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");
    const { week } = c.req.valid("query");

    const result = await getPickemStandings(db, leagueId, sessionUser.id, week);
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
