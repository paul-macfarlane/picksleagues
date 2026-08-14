import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  AdminNflGameStatContextsResponseSchema,
  AdminNflTeamSeasonStatsResponseSchema,
  ErrorResponseSchema,
  NflGameStatContextOverrideRequestSchema,
  NflGameStatContextOverrideResponseSchema,
  NflTeamSeasonStatsOverrideRequestSchema,
  NflTeamSeasonStatsOverrideResponseSchema,
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
import {
  setNflGameStatContextOverride,
  setNflTeamSeasonStatsOverride,
} from "../services/nfl/admin-stats-overrides";

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
  summary: "Browse a season's synced NFL team stats with provider, override, and resolved values",
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

const setAdminNflStatsOverrideRoute = createRoute({
  method: "put",
  path: "/admin/nfl-stats/{statsId}/override",
  operationId: "setAdminNflStatsOverride",
  summary: "Set or clear manual overrides on a team's season record facts",
  request: {
    params: z.object({ statsId: z.uuid() }),
    body: {
      content: { "application/json": { schema: NflTeamSeasonStatsOverrideRequestSchema } },
    },
  },
  responses: {
    200: {
      description:
        "The corrected row with provider, override, and resolved values — derived averages and ranks on the member surface follow the resolved facts (ADR-0041)",
      content: { "application/json": { schema: NflTeamSeasonStatsOverrideResponseSchema } },
    },
    ...browserResponses,
    400: errorResponse("No fields supplied, or a field fails its range rule"),
    404: errorResponse("No such stats row (team_season_stats_not_found)"),
  },
});

const listAdminNflStatContextsRoute = createRoute({
  method: "get",
  path: "/admin/nfl-stat-contexts",
  operationId: "listAdminNflStatContexts",
  summary: "Browse a week's per-game stat context with provider, override, and resolved payloads",
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

const setAdminNflStatContextOverrideRoute = createRoute({
  method: "put",
  path: "/admin/nfl-stat-contexts/{gameId}/override",
  operationId: "setAdminNflStatContextOverride",
  summary: "Replace a game's stat-context override layer",
  request: {
    params: z.object({ gameId: z.uuid() }),
    body: {
      content: { "application/json": { schema: NflGameStatContextOverrideRequestSchema } },
    },
  },
  responses: {
    200: {
      description:
        "The game's context with provider, override, and resolved payloads. The body replaces the whole override layer (an absent field carries no override; an empty body clears the layer)",
      content: { "application/json": { schema: NflGameStatContextOverrideResponseSchema } },
    },
    ...browserResponses,
    400: errorResponse("A field fails its shape or range rule"),
    404: errorResponse(
      "The game doesn't exist, or the stats sync hasn't written a context payload for it yet — there's nothing to correct until it does (game_stat_context_not_found)",
    ),
  },
});

/**
 * The admin Stats tab's routes (STAT-7, ADR-0041) — NFL-named like every stats
 * surface (ADR-0040), and split from `routes/admin.ts` so the sport-specific
 * surfaces live in a sport-named home. Same gating as the rest of the admin
 * surface: session + `users.app_role` server-side (ADR-0013), mounted
 * unconditionally.
 */
export function adminNflStatsRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  for (const path of [
    "/admin/nfl-stats",
    "/admin/nfl-stats/*",
    "/admin/nfl-stat-contexts",
    "/admin/nfl-stat-contexts/*",
  ]) {
    app.use(path, requireSession(deps));
    app.use(path, requireAdmin(deps));
    app.use(path, requireDbAndClock(deps));
  }

  app.openapi(listAdminNflStatsRoute, async (c) => {
    const { season } = c.req.valid("query");
    return c.json(await listNflTeamSeasonStats(c.get("db"), season), 200);
  });

  app.openapi(setAdminNflStatsOverrideRoute, async (c) => {
    const { statsId } = c.req.valid("param");
    const result = await setNflTeamSeasonStatsOverride(
      c.get("db"),
      c.get("clock"),
      c.get("sessionUser").id,
      statsId,
      c.req.valid("json"),
    );
    if (!result.ok) {
      return c.json(
        ErrorResponseSchema.parse({ error: result.reason, message: "Stats row not found." }),
        404,
      );
    }
    return c.json({ stats: result.stats }, 200);
  });

  app.openapi(listAdminNflStatContextsRoute, async (c) => {
    const { weekId } = c.req.valid("query");
    return c.json({ games: await listNflGameStatContexts(c.get("db"), weekId) }, 200);
  });

  app.openapi(setAdminNflStatContextOverrideRoute, async (c) => {
    const { gameId } = c.req.valid("param");
    const result = await setNflGameStatContextOverride(
      c.get("db"),
      c.get("clock"),
      c.get("sessionUser").id,
      gameId,
      c.req.valid("json"),
    );
    if (!result.ok) {
      return c.json(
        ErrorResponseSchema.parse({
          error: result.reason,
          message:
            "No stat context for this game yet — it arrives with the stats sync, and there's nothing to correct until it does.",
        }),
        404,
      );
    }
    return c.json({ game: result.game }, 200);
  });

  return app;
}
