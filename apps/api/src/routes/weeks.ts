import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ERROR_CODE,
  ErrorResponseSchema,
  LeagueWeeksResponseSchema,
  WeekSlateResponseSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { pickemRefusal } from "../lib/pickem-refusals";
import {
  errorResponse,
  LEAGUE_NOT_FOUND_404,
  MISCONFIGURED_500,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import { listLeagueWeeks } from "../services/league-weeks";
import { getWeekSlate } from "../services/slate";

/**
 * The mode-agnostic week surfaces: the slate a week's games make up, and the
 * weeks a league plays. Every NFL mode reads both, which is why they sit outside
 * `/leagues/{id}/pickem/*` — only the league-weeks gate is Pick'em-only today
 * (see `services/league-weeks.ts`).
 */

const WeekIdParamsSchema = z.object({ weekId: z.uuid() });

const getWeekGames = createRoute({
  method: "get",
  path: "/weeks/{weekId}/games",
  operationId: "getWeekSlate",
  summary: "A week's game slate with current spreads and derived lock state",
  request: { params: WeekIdParamsSchema },
  responses: {
    200: {
      description: "The week and its games, ordered by kickoff",
      content: { "application/json": { schema: WeekSlateResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    404: errorResponse("No such week"),
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
    400: errorResponse(
      "The league's mode has no start/end week range to clip to (wrong_league_mode) — both NFL modes do, March Madness does not",
    ),
    401: UNAUTHENTICATED_401,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

export function weekRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/weeks/*", requireSession(deps));
  app.use("/weeks/*", requireDbAndClock(deps));
  // Scoped to this file's own route rather than all of `/leagues/*`, matching
  // members.ts — a broader pattern would make the extra session lookup a
  // function of which route file mounts last.
  app.use("/leagues/:leagueId/weeks", requireSession(deps));
  app.use("/leagues/:leagueId/weeks", requireDbAndClock(deps));

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

  return app;
}
