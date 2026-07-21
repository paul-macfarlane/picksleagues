import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  MeResponseSchema,
  UpdateMeRequestSchema,
  type MeResponse,
} from "@picksleagues/schemas";
import type { users } from "@picksleagues/db";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { sessionMiddleware, type SessionVariables } from "../middleware/session";
import { getUser, updateProfile } from "../services/users";

function serializeMe(user: typeof users.$inferSelect): MeResponse {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    image: user.image,
  };
}

const getMe = createRoute({
  method: "get",
  path: "/me",
  operationId: "getMe",
  summary: "Get the caller's own profile",
  responses: {
    200: {
      description: "The caller's profile",
      content: { "application/json": { schema: MeResponseSchema } },
    },
    401: {
      description: "No valid session",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description:
        "Server misconfiguration — structurally unreachable outside generate-openapi.ts, which builds the app with no deps and only ever requests the spec document, never invoking this handler.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const updateMe = createRoute({
  method: "patch",
  path: "/me",
  operationId: "updateMe",
  summary: "Claim/change the caller's username and/or edit their display name",
  request: {
    body: {
      content: { "application/json": { schema: UpdateMeRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Profile updated",
      content: { "application/json": { schema: MeResponseSchema } },
    },
    400: {
      description: "No fields supplied, or a supplied field fails its format rule",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "No valid session",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Username already taken by another user",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: {
      description:
        "Server misconfiguration — structurally unreachable outside generate-openapi.ts, which builds the app with no deps and only ever requests the spec document, never invoking this handler.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export function meRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables }>({ defaultHook: zodValidationHook });

  app.use("/me", async (c, next) => {
    if (!deps.auth) {
      return c.json(
        ErrorResponseSchema.parse({ error: "misconfigured", message: "Auth is not configured." }),
        500,
      );
    }
    return sessionMiddleware(deps.auth)(c, next);
  });

  app.openapi(getMe, async (c) => {
    if (!deps.db) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Database is not configured.",
        }),
        500,
      );
    }

    const sessionUser = c.get("sessionUser");
    const user = await getUser(deps.db, sessionUser.id);
    if (!user) {
      // Session cookie is still valid but the user row is gone (e.g. deleted
      // mid-session) — treat it as unauthenticated rather than 404ing /me.
      return c.json(
        ErrorResponseSchema.parse({
          error: "unauthenticated",
          message: "Sign in to continue.",
        }),
        401,
      );
    }

    return c.json(serializeMe(user), 200);
  });

  app.openapi(updateMe, async (c) => {
    if (!deps.db || !deps.clock) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "misconfigured",
          message: "Database/clock are not configured.",
        }),
        500,
      );
    }

    const sessionUser = c.get("sessionUser");
    const clock = await deps.clock();
    const { username, displayName } = c.req.valid("json");

    const result = await updateProfile(deps.db, clock, sessionUser.id, { username, displayName });
    if (!result.ok) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "username_taken",
          message: "That username is already taken.",
        }),
        409,
      );
    }

    return c.json(serializeMe(result.user), 200);
  });

  return app;
}
