import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  AdminNflGameStatContextsResponseSchema,
  AdminNflTeamSeasonStatsResponseSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import {
  errorResponse,
  MISCONFIGURED_500,
  NOT_ADMIN_403,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import {
  requireAdmin,
  requireDbAndClock,
  requireSession,
  type DepsVariables,
} from "../lib/require-deps";
import type { SessionVariables } from "../middleware/session";
import { listNflGameStatContexts, listNflTeamSeasonStats } from "../services/nfl/admin-stats-data";

const browserResponses = {
  400: errorResponse("A request param failed its format rule"),
  401: UNAUTHENTICATED_401,
  403: NOT_ADMIN_403,
  500: MISCONFIGURED_500,
};

// `coerce` because the year rides a query string; bounds match the seasons the
// app can plausibly hold (the fallback reads one year back from any synced
// season, ADR-0040).
const AdminNflStatsQuerySchema = z.object({
  season: z.coerce.number().int().min(2000).max(2100).optional(),
});

const listAdminNflStatsRoute = createRoute({
  method: "get",
  path: "/admin/nfl-stats",
  operationId: "listAdminNflStats",
  summary: "Browse a season's synced NFL team stats",
  request: { query: AdminNflStatsQuerySchema },
  responses: {
    200: {
      description:
        "Every stored season year, the year served (defaulted to the newest stored), and that season's per-team rows ordered by abbreviation — a requested year with no rows is an empty list, not a fallback to a different season",
      content: { "application/json": { schema: AdminNflTeamSeasonStatsResponseSchema } },
    },
    ...browserResponses,
  },
});

const listAdminNflStatContextsRoute = createRoute({
  method: "get",
  path: "/admin/nfl-stat-contexts",
  operationId: "listAdminNflStatContexts",
  summary: "Browse a week's per-game stat context",
  request: { query: z.object({ weekId: z.uuid() }) },
  responses: {
    200: {
      description:
        "The week's games ordered by resolved kickoff, each with its stored context or null where the stats sync hasn't reached it — empty for an unknown week id, indistinguishable from a week with no games synced",
      content: { "application/json": { schema: AdminNflGameStatContextsResponseSchema } },
    },
    ...browserResponses,
  },
});

/**
 * The admin Stats tab's routes (STAT-7) — NFL-named like every stats surface
 * (ADR-0040), and split from `routes/admin.ts` so the sport-specific surfaces
 * live in a sport-named home. Same gating as the rest of the admin surface:
 * session + `users.app_role` server-side (ADR-0013), mounted unconditionally.
 */
export function adminNflStatsRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  for (const path of ["/admin/nfl-stats", "/admin/nfl-stat-contexts"]) {
    app.use(path, requireSession(deps));
    app.use(path, requireAdmin(deps));
    app.use(path, requireDbAndClock(deps));
  }

  app.openapi(listAdminNflStatsRoute, async (c) => {
    const { season } = c.req.valid("query");
    return c.json(await listNflTeamSeasonStats(c.get("db"), season), 200);
  });

  app.openapi(listAdminNflStatContextsRoute, async (c) => {
    const { weekId } = c.req.valid("query");
    return c.json({ games: await listNflGameStatContexts(c.get("db"), weekId) }, 200);
  });

  return app;
}
