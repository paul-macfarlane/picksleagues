import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { isSimEnabled } from "@picksleagues/core";
import { ERROR_CODE, ErrorResponseSchema } from "@picksleagues/schemas";
import type { AppDeps } from "./deps";
import { zodValidationHook } from "./lib/default-hook";
import { logError } from "./lib/logger";
import { adminRoutes } from "./routes/admin";
import { adminNflStatsRoutes } from "./routes/admin-nfl-stats";
import { discoveryRoutes } from "./routes/discovery";
import { gameRoutes } from "./routes/games";
import { healthRoutes } from "./routes/health";
import { jobRoutes } from "./routes/jobs";
import { inviteRoutes } from "./routes/invites";
import { invitePreviewRoutes } from "./routes/invite-preview";
import { leagueRoutes } from "./routes/leagues";
import { memberRoutes } from "./routes/members";
import { pickemRoutes } from "./routes/pickem";
import { meRoutes } from "./routes/me";
import { simRoutes } from "./routes/sim";
import { survivorRoutes } from "./routes/survivor";
import { weekRoutes } from "./routes/weeks";

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
  // The invite link-unfurl document (ADR-0038). Mounted like the rest, but it
  // contributes nothing to the generated spec — it serves HTML to preview bots,
  // not JSON to the SPA.
  app.route("/", invitePreviewRoutes(deps));
  app.route("/", memberRoutes(deps));
  app.route("/", discoveryRoutes(deps));
  app.route("/", weekRoutes(deps));
  app.route("/", gameRoutes(deps));
  app.route("/", pickemRoutes(deps));
  app.route("/", survivorRoutes(deps));

  // Admin surface (`users.app_role`, ADR-0013) — mounted unconditionally in
  // every env, unlike the sim routes; server-side auth gates it, not
  // non-registration (that's for simulator-only routes, per `isSimEnabled`).
  app.route("/", adminRoutes(deps));
  app.route("/", adminNflStatsRoutes(deps));

  // The simulator is the one surface gated by *not existing* rather than by auth
  // (ADR-0011): where `isSimEnabled` is false — always in production, and
  // wherever `SIM_ENABLED` is off — these paths 404 because no handler was ever
  // registered, so no authorization bug can expose them.
  //
  // The env-less case must still mount, because generate-openapi.ts builds the
  // app with no deps at all and these routes have to land in the committed
  // contract for the SPA to reach them through the generated client like every
  // other endpoint (ADR-0012). A real deployment always supplies env (loadEnv
  // throws otherwise), so nothing outside generate-openapi.ts and the tests
  // that deliberately mimic it constructs an env-less app — and constructing
  // one with `auth`/`db`/`clock` supplied but no `env` (as some tests do to
  // exercise other routes) would serve the sim routes normally, not 500 them.
  if (deps.env === undefined || isSimEnabled(deps.env)) {
    app.route("/", simRoutes(deps));
  }

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
