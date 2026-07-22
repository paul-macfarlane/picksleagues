import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { DiscoveryResponseSchema } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import { MISCONFIGURED_500, UNAUTHENTICATED_401 } from "../lib/route-responses";
import type { SessionVariables } from "../middleware/session";
import { discoverLeagues } from "../services/discovery";

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
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/discovery", requireSession(deps));
  app.use("/discovery", requireDbAndClock(deps));

  app.openapi(getDiscovery, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const { q } = c.req.valid("query");

    const leagues = await discoverLeagues(db, clock, q);
    return c.json({ leagues }, 200);
  });

  return app;
}
