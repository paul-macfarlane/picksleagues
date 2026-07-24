import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { ERROR_CODE, ErrorResponseSchema } from "@picksleagues/schemas";
import type { AppDeps } from "./deps";
import { zodValidationHook } from "./lib/default-hook";
import { logError } from "./lib/logger";
import { discoveryRoutes } from "./routes/discovery";
import { healthRoutes } from "./routes/health";
import { jobRoutes } from "./routes/jobs";
import { inviteRoutes } from "./routes/invites";
import { leagueRoutes } from "./routes/leagues";
import { memberRoutes } from "./routes/members";
import { meRoutes } from "./routes/me";

export type { AppDeps };

export function createApp(deps: AppDeps = {}) {
  const app = new OpenAPIHono({ defaultHook: zodValidationHook }).basePath("/api");

  app.onError((error, c) => {
    // Hono itself THROWS typed 4xx refusals (e.g. HTTPException(400) for a
    // malformed JSON body — that path never reaches zodValidationHook, which
    // only sees parseable bodies). Those are client errors, not bugs: pass
    // them through instead of masking them as logged 500s.
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    // Everything else thrown is a bug — expected refusals are typed results
    // mapped by handlers, and schema validation 400s come from zodValidationHook.
    logError("unhandled_error", { method: c.req.method, path: c.req.path, error });
    return c.json(
      ErrorResponseSchema.parse({ error: ERROR_CODE.INTERNAL, message: "Something went wrong." }),
      500,
    );
  });

  app.route("/", healthRoutes);

  // Mounted unconditionally (deps or not) so generate-openapi.ts — which calls
  // createApp() with no deps — still emits this route in the committed spec;
  // meRoutes' handlers 500 defensively if a dep is actually missing at request
  // time, which real deployments (dev.ts, vercel.ts) never hit.
  app.route("/", meRoutes(deps));

  // Mounted unconditionally for the same reason as meRoutes — see comment
  // above. No concrete job routes exist yet (DATA-4/5/6 add them), so this
  // currently contributes nothing to the generated spec beyond the guard.
  app.route("/", jobRoutes(deps));

  app.route("/", leagueRoutes(deps));
  app.route("/", inviteRoutes(deps));
  app.route("/", memberRoutes(deps));
  app.route("/", discoveryRoutes(deps));

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
