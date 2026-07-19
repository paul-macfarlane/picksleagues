import { OpenAPIHono } from "@hono/zod-openapi";
import { healthRoutes } from "./routes/health.js";

export type AppDeps = {
  auth?: { handler: (req: Request) => Response | Promise<Response> };
};

export function createApp(deps: AppDeps = {}) {
  const app = new OpenAPIHono().basePath("/api");

  app.route("/", healthRoutes);

  // Better Auth owns /api/auth/* as its own typed surface (client generated
  // from the auth instance, not this OpenAPI doc) — deliberately outside the
  // contract-first API. generate-openapi.ts calls createApp() with no auth,
  // so the committed spec never includes it.
  if (deps.auth) {
    const auth = deps.auth;
    app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
  }

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
