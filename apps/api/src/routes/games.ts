import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ERROR_CODE, ErrorResponseSchema, GameStatsResponseSchema } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { errorResponse, MISCONFIGURED_500, UNAUTHENTICATED_401 } from "../lib/route-responses";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import { getGameStats } from "../services/game-stats";

/**
 * Mode-agnostic game surfaces, like weeks.ts: every NFL mode's slate rows open
 * the same matchup stats sheet, which is what earns the unqualified name
 * (engineering rules §naming — Survivor consumes this unchanged). Session-only
 * gating, no league scoping: stats describe public schedule/team data, carry
 * no pick information, and are the same for every member.
 */

const getGameStatsRoute = createRoute({
  method: "get",
  path: "/games/{gameId}/stats",
  operationId: "getGameStats",
  summary: "One game's matchup stats: team records plus injuries/FPI/form context (ADR-0040)",
  request: { params: z.object({ gameId: z.uuid() }) },
  responses: {
    200: {
      description:
        "Per-team season records (prior season while the current has no games) and matchup context; blocks are null where ingestion has nothing",
      content: { "application/json": { schema: GameStatsResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    404: errorResponse("No such game"),
    500: MISCONFIGURED_500,
  },
});

export function gameRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/games/*", requireSession(deps));
  app.use("/games/*", requireDbAndClock(deps));

  app.openapi(getGameStatsRoute, async (c) => {
    const db = c.get("db");
    const { gameId } = c.req.valid("param");

    const stats = await getGameStats(db, gameId);
    if (!stats) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.GAME_NOT_FOUND,
          message: "Game not found.",
        }),
        404,
      );
    }

    return c.json(stats, 200);
  });

  return app;
}
