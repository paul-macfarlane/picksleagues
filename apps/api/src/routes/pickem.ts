import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  LeaguePickSummarySchema,
  PickemSeasonRangePresetsResponseSchema,
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
  getPickemSeasonRangePresets,
  getPickemWeekPicks,
  submitPickemPicks,
} from "../services/pickem/picks";
import { getPickemStandings } from "../services/pickem/standings";
import { pickemSeasonRangePresetsForCreate } from "../services/leagues/season-range";

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
      content: { "application/json": { schema: LeaguePickSummarySchema } },
    },
    400: errorResponse("Not a Pick'em league (wrong_league_mode)"),
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const getSeasonRangePresets = createRoute({
  method: "get",
  path: "/pickem/season-range-presets",
  operationId: "getPickemSeasonRangePresets",
  summary:
    "Which of the three ADR-0020 season-range presets the latest ingested NFL season can still start (create form)",
  responses: {
    200: {
      description:
        "The latest ingested NFL season's year (null if none ingested) and which presets it can still start",
      content: { "application/json": { schema: PickemSeasonRangePresetsResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    500: MISCONFIGURED_500,
  },
});

const getLeagueSeasonRangePresets = createRoute({
  method: "get",
  path: "/leagues/{leagueId}/pickem/season-range-presets",
  operationId: "getLeaguePickemSeasonRangePresets",
  summary:
    "Which presets the league's own bound season can still start (commissioner, settings editor only)",
  request: { params: LeagueIdParamsSchema },
  responses: {
    200: {
      description:
        "The league's bound season year and which presets it can still start — the settings editor's availability hint",
      content: { "application/json": { schema: PickemSeasonRangePresetsResponseSchema } },
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
        "Rows in rank order, with each member's record and the time settlement last wrote the board",
      content: { "application/json": { schema: PickemStandingsResponseSchema } },
    },
    400: errorResponse(
      "Not a Pick'em league (wrong_league_mode), or `week` is not a week of this league's season (week_out_of_range)",
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
  summary: "Submit the caller's picks for a week — once, in full, and for good",
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
      "Not a Pick'em league (wrong_league_mode), week outside the league's range (week_out_of_range), a game not in this week's slate (game_not_in_week), the same game picked twice (duplicate_pick), or the set isn't the week's required size — min(picksPerWeek, games still unlocked and pickable) — either over it (too_many_picks) or under it (pick_set_incomplete)",
    ),
    401: UNAUTHENTICATED_401,
    404: LEAGUE_NOT_FOUND_404,
    409: errorResponse(
      "The caller already submitted this week and a week is one immutable submission (already_submitted), a submitted game has already kicked off (pick_locked), the game was cancelled (game_not_pickable), the accepted spread is no longer current (spread_stale — refetch the slate and re-prompt), the game has no spread posted yet (spread_unavailable — nothing to accept until the odds sync lands), or the season has concluded (league_concluded)",
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

  // The create-form endpoint sits outside `/leagues/:leagueId/pickem/*` — it
  // isn't league-scoped at all, so it needs its own middleware registration.
  app.use("/pickem/*", requireSession(deps));
  app.use("/pickem/*", requireDbAndClock(deps));

  app.openapi(getSeasonRangePresets, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");

    const result = await pickemSeasonRangePresetsForCreate(db, clock);
    return c.json(result, 200);
  });

  app.openapi(getLeagueSeasonRangePresets, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");

    const result = await getPickemSeasonRangePresets(db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      const { body, status } = pickemRefusal(result.reason);
      return c.json(ErrorResponseSchema.parse(body), status);
    }

    return c.json(result.value, 200);
  });

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
