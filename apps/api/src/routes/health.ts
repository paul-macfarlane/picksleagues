import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HealthResponseSchema } from "@picksleagues/schemas";

const getHealth = createRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  summary: "Liveness check",
  responses: {
    200: {
      description: "Service is up",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

export const healthRoutes = new OpenAPIHono().openapi(getHealth, (c) =>
  c.json({ status: "ok" as const }, 200),
);
