import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { DiscoveryResponseSchema, ErrorResponseSchema } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { sessionMiddleware, type SessionVariables } from "../middleware/session";
import { discoverLeagues } from "../services/discovery";

const MISCONFIGURED_500 = {
  description:
    "Server misconfiguration — structurally unreachable outside generate-openapi.ts, which builds the app with no deps and only ever requests the spec document, never invoking this handler.",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const UNAUTHENTICATED_401 = {
  description: "No valid session",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const getDiscovery = createRoute({
  method: "get",
  path: "/discovery",
  operationId: "discoverLeagues",
  summary: "Browse public, joinable leagues with optional name search",
  request: { query: z.object({ q: z.string().max(50).optional() }) },
  responses: {
    200: {
      description: "Public, active leagues that haven't passed their join cutoff",
      content: { "application/json": { schema: DiscoveryResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    500: MISCONFIGURED_500,
  },
});

export function discoveryRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables }>({ defaultHook: zodValidationHook });

  app.use("/discovery", async (c, next) => {
    if (!deps.auth) {
      return c.json(
        ErrorResponseSchema.parse({ error: "misconfigured", message: "Auth is not configured." }),
        500,
      );
    }
    return sessionMiddleware(deps.auth)(c, next);
  });

  app.openapi(getDiscovery, async (c) => {
    if (!deps.db || !deps.clock) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Database/clock are not configured.",
        }),
        500,
      );
    }

    const clock = await deps.clock();
    const { q } = c.req.valid("query");

    const leagues = await discoverLeagues(deps.db, clock, q);
    return c.json({ leagues }, 200);
  });

  return app;
}
