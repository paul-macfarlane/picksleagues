import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  SubmitSurvivorPickRequestSchema,
  SurvivorWeekPicksResponseSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { survivorRefusal } from "../lib/survivor-refusals";
import {
  errorResponse,
  LEAGUE_NOT_FOUND_404,
  MISCONFIGURED_500,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import { getSurvivorWeekPicks, submitSurvivorPick } from "../services/survivor/picks";

const LeagueWeekParamsSchema = z.object({ leagueId: z.uuid(), weekId: z.uuid() });

const getLeagueWeekPicks = createRoute({
  method: "get",
  path: "/leagues/{leagueId}/survivor/weeks/{weekId}/picks",
  operationId: "getSurvivorWeekPicks",
  summary: "Every member's pick for a week, filtered by kickoff visibility",
  request: { params: LeagueWeekParamsSchema },
  responses: {
    200: {
      description:
        "One entry per member. The caller sees their own pick always; another member's appears only once that game has kicked off, with `hasPicked` reporting that one exists. `consumedTeamIds` is the caller's own burned teams, excluding this week's",
      content: { "application/json": { schema: SurvivorWeekPicksResponseSchema } },
    },
    400: errorResponse(
      "Not a Survivor league (wrong_league_mode), or the week is outside this league's season or resolved range, or is not a regular-season week (week_out_of_range)",
    ),
    401: UNAUTHENTICATED_401,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

// Singular by design, and not a mistake against the plural read above: this
// writes the caller's one pick for the week, while the read serves the whole
// league's.
const putLeagueWeekPick = createRoute({
  method: "put",
  path: "/leagues/{leagueId}/survivor/weeks/{weekId}/pick",
  operationId: "submitSurvivorPick",
  summary: "Make or change the caller's pick for a week — allowed until that game kicks off",
  request: {
    params: LeagueWeekParamsSchema,
    body: { content: { "application/json": { schema: SubmitSurvivorPickRequestSchema } } },
  },
  responses: {
    200: {
      description: "Pick saved; the week is returned as the read endpoint would serve it",
      content: { "application/json": { schema: SurvivorWeekPicksResponseSchema } },
    },
    400: errorResponse(
      "Not a Survivor league (wrong_league_mode), the week is outside this league's resolved regular-season range (week_out_of_range), or the game isn't in this week's slate (game_not_in_week)",
    ),
    401: UNAUTHENTICATED_401,
    404: LEAGUE_NOT_FOUND_404,
    409: errorResponse(
      "The picked game — or the pick this would replace — has already kicked off (pick_locked), the game was cancelled (game_not_pickable), the team isn't playing in it (team_not_in_game), the caller has already used that team this season (team_consumed), settlement has eliminated the caller (member_eliminated), the accepted spread is no longer current (spread_stale — refetch the slate and re-prompt), the game has no spread posted yet (spread_unavailable), or the season has concluded (league_concluded)",
    ),
    500: MISCONFIGURED_500,
  },
});

export function survivorRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  // Scoped to this file's own routes rather than all of `/leagues/*`, matching
  // pickem.ts — a broader pattern would make the extra session lookup a
  // function of which route file mounts last.
  app.use("/leagues/:leagueId/survivor/*", requireSession(deps));
  app.use("/leagues/:leagueId/survivor/*", requireDbAndClock(deps));

  app.openapi(getLeagueWeekPicks, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId, weekId } = c.req.valid("param");

    const result = await getSurvivorWeekPicks(db, clock, leagueId, weekId, sessionUser.id);
    if (!result.ok) {
      const { body, status } = survivorRefusal(result.reason);
      return c.json(ErrorResponseSchema.parse(body), status);
    }

    return c.json(result.value, 200);
  });

  app.openapi(putLeagueWeekPick, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId, weekId } = c.req.valid("param");
    const submission = c.req.valid("json");

    const result = await submitSurvivorPick(
      db,
      clock,
      leagueId,
      weekId,
      sessionUser.id,
      submission,
    );
    if (!result.ok) {
      const { body, status } = survivorRefusal(result.reason);
      return c.json(ErrorResponseSchema.parse(body), status);
    }

    return c.json(result.value, 200);
  });

  return app;
}
