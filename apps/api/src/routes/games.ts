import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ERROR_CODE, ErrorResponseSchema, NflGameStatsResponseSchema } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { errorResponse, MISCONFIGURED_500, UNAUTHENTICATED_401 } from "../lib/route-responses";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import { getNflGameStats } from "../services/nfl/game-stats";

/**
 * Game surfaces. The `/games` mount is shared (games span sports), but the
 * stats route is NFL-qualified: every NFL *mode* consumes it unchanged, while
 * another sport's stats carry a different shape entirely (no ties, different
 * context), so the sport owns the name (engineering rules §naming — owner,
 * 2026-08-13). Session-only gating, no league scoping: stats describe public
 * schedule/team data, carry no pick information, and are the same for every
 * member.
 */

const getNflGameStatsRoute = createRoute({
  method: "get",
  path: "/games/{gameId}/nfl-stats",
  operationId: "getNflGameStats",
  summary: "One game's matchup stats: team records plus injuries/FPI/form context (ADR-0040)",
  request: { params: z.object({ gameId: z.uuid() }) },
  responses: {
    200: {
      description:
        "Per-team season records (prior season while the current has no games) and matchup context; blocks are null where ingestion has nothing",
      content: { "application/json": { schema: NflGameStatsResponseSchema } },
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

  app.openapi(getNflGameStatsRoute, async (c) => {
    const db = c.get("db");
    const { gameId } = c.req.valid("param");

    const stats = await getNflGameStats(db, gameId);
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
