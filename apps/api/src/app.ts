import { OpenAPIHono } from "@hono/zod-openapi";
import { healthRoutes } from "./routes/health.js";

export function createApp() {
  const app = new OpenAPIHono().basePath("/api");

  app.route("/", healthRoutes);

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Picks Leagues API",
      version: "0.1.0",
    },
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
