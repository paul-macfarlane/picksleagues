import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  AgentReconciliationResponseSchema,
  AgentLeagueDiscoveryQuerySchema,
  AgentLeagueDiscoveryResponseSchema,
  AgentGameResponseSchema,
  AgentLeagueDiagnosticsResponseSchema,
  AgentSystemResponseSchema,
  AgentWeekResponseSchema,
  ERROR_CODE,
  ErrorResponseSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { errorResponse, MISCONFIGURED_500, UNAUTHENTICATED_401 } from "../lib/route-responses";
import { requireDbAndClock, type DepsVariables } from "../lib/require-deps";
import { agentAuditMiddleware, agentTokenMiddleware } from "../middleware/agent-token";
import { agentGame, agentSystem, agentWeek } from "../services/agent-diagnostics";
import { agentLeagueDiagnostics } from "../services/agent-league-diagnostics";

import { agentScoringReconciliation } from "../services/agent-reconciliation";

import { agentLeagueDiscovery } from "../services/agent-league-discovery";

const responses = {
  400: errorResponse("Invalid diagnostic identifier"),
  401: UNAUTHENTICATED_401,
  404: errorResponse("Diagnostic resource not found"),
  500: MISCONFIGURED_500,
};
const security = [{ AgentBearer: [] }];

/** One router defines both the runtime surface and its isolated OpenAPI contract. */
export function agentRoutes(deps: AppDeps = {}) {
  const app = new OpenAPIHono<{ Variables: DepsVariables }>({
    // Zod errors can contain supplied input; this boundary exposes only a fixed refusal.
    defaultHook: (result, c) => {
      if (!result.success)
        return c.json(
          { error: ERROR_CODE.VALIDATION, message: "Invalid diagnostic identifier." },
          400,
        );
    },
  }).basePath("/agent/v1");
  app.openAPIRegistry.registerComponent("securitySchemes", "AgentBearer", {
    type: "http",
    scheme: "bearer",
  });
  app.use("/*", agentAuditMiddleware(deps.env));
  app.use("/*", agentTokenMiddleware(deps.env));
  app.use("/*", async (c, next) => {
    if (c.req.method !== "GET") {
      c.header("Allow", "GET");
      return c.json({ error: ERROR_CODE.VALIDATION, message: "Only GET is supported." }, 405);
    }
    await next();
  });
  app.use("/*", requireDbAndClock(deps));
  app.openapi(
    createRoute({
      method: "get",
      path: "/system",
      operationId: "agentSystem",
      security,
      summary: "Environment and current NFL ingestion diagnostics",
      responses: {
        ...responses,
        200: {
          description: "Technical system snapshot",
          content: { "application/json": { schema: AgentSystemResponseSchema } },
        },
      },
    }),
    async (c) => c.json(await agentSystem(c.get("db"), c.get("clock"), deps.env!.APP_ENV), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/weeks/{weekId}",
      operationId: "agentWeek",
      security,
      summary: "Week game-state aggregates",
      request: { params: z.object({ weekId: z.uuid() }) },
      responses: {
        ...responses,
        200: {
          description: "Week diagnostics",
          content: { "application/json": { schema: AgentWeekResponseSchema } },
        },
      },
    }),
    async (c) => {
      const result = await agentWeek(c.get("db"), c.get("clock"), c.req.valid("param").weekId);
      if (!result)
        return c.json(
          ErrorResponseSchema.parse({
            error: ERROR_CODE.WEEK_NOT_FOUND,
            message: "Week not found.",
          }),
          404,
        );
      return c.json(result, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/games/{gameId}",
      operationId: "agentGame",
      security,
      summary: "Technical game state with neutral freshness",
      request: { params: z.object({ gameId: z.uuid() }) },
      responses: {
        ...responses,
        200: {
          description: "Game diagnostics",
          content: { "application/json": { schema: AgentGameResponseSchema } },
        },
      },
    }),
    async (c) => {
      const result = await agentGame(c.get("db"), c.get("clock"), c.req.valid("param").gameId);
      if (!result)
        return c.json(
          ErrorResponseSchema.parse({
            error: ERROR_CODE.GAME_NOT_FOUND,
            message: "Game not found.",
          }),
          404,
        );
      return c.json(result, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/league-seasons/{leagueSeasonId}/diagnostics",
      operationId: "agentLeagueDiagnostics",
      security,
      summary: "Aggregate NFL league-season diagnostics without member identity",
      request: { params: z.object({ leagueSeasonId: z.uuid() }) },
      responses: {
        ...responses,
        200: {
          description: "League-season diagnostic counts",
          content: { "application/json": { schema: AgentLeagueDiagnosticsResponseSchema } },
        },
      },
    }),
    async (c) => {
      const result = await agentLeagueDiagnostics(
        c.get("db"),
        c.get("clock"),
        c.req.valid("param").leagueSeasonId,
      );
      if (!result)
        return c.json(
          ErrorResponseSchema.parse({
            error: ERROR_CODE.LEAGUE_NOT_FOUND,
            message: "League season not found.",
          }),
          404,
        );
      return c.json(result, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/league-seasons/{leagueSeasonId}/reconciliation",
      operationId: "agentScoringReconciliation",
      security,
      summary: "Compare stored scoring with a read-only replay; aggregate differences only",
      request: { params: z.object({ leagueSeasonId: z.uuid() }) },
      responses: {
        ...responses,
        200: {
          description: "Scoring reconciliation counts",
          content: { "application/json": { schema: AgentReconciliationResponseSchema } },
        },
      },
    }),
    async (c) => {
      const result = await agentScoringReconciliation(
        c.get("db"),
        c.get("clock"),
        c.req.valid("param").leagueSeasonId,
      );
      if (!result)
        return c.json(
          { error: ERROR_CODE.LEAGUE_NOT_FOUND, message: "League season not found." },
          404,
        );
      return c.json(result, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/league-seasons",
      operationId: "agentLeagueDiscovery",
      security,
      summary:
        "Discover paginated NFL league-season monitoring targets, including concluded leagues",
      request: { query: AgentLeagueDiscoveryQuerySchema },
      responses: {
        ...responses,
        200: {
          description:
            "Bounded technical target list; empty when the season has no supported targets",
          content: { "application/json": { schema: AgentLeagueDiscoveryResponseSchema } },
        },
      },
    }),
    async (c) => c.json(await agentLeagueDiscovery(c.get("db"), c.req.valid("query")), 200),
  );
  return app;
}

/** Contains only the agent GET operations and their reachable schemas/security definitions. */
export function agentOpenApiDocument() {
  return new OpenAPIHono()
    .basePath("/api")
    .route("/", agentRoutes())
    .getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Picks Leagues Agent API", version: "1.0.0" },
    });
}
