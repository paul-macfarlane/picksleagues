import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { isSimEnabled } from "@picksleagues/core";
import {
  APP_ROLE,
  ERROR_CODE,
  ErrorResponseSchema,
  MeResponseSchema,
  UpdateMeRequestSchema,
  type MeResponse,
} from "@picksleagues/schemas";
import type { users } from "@picksleagues/db";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import { errorResponse, MISCONFIGURED_500, UNAUTHENTICATED_401 } from "../lib/route-responses";
import type { SessionVariables } from "../middleware/session";
import { deleteAccount, getUser, updateProfile } from "../services/users";

function serializeMe(
  user: typeof users.$inferSelect,
  capabilities: { simEnabled: boolean },
): MeResponse {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    image: user.image,
    // Admin capability is the user's own role column (ADR-0013), so it travels
    // with the row rather than being resolved from env alongside `simEnabled`.
    isAdmin: user.appRole === APP_ROLE.ADMIN,
    ...capabilities,
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
    401: UNAUTHENTICATED_401,
    500: MISCONFIGURED_500,
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
    400: errorResponse("No fields supplied, or a supplied field fails its format rule"),
    401: UNAUTHENTICATED_401,
    409: errorResponse("Username already taken by another user"),
    500: MISCONFIGURED_500,
  },
});

const deleteMe = createRoute({
  method: "delete",
  path: "/me",
  operationId: "deleteMe",
  summary: "Delete (anonymize) the caller's own account",
  responses: {
    204: {
      description: "Account deleted — profile anonymized, OAuth identities and sessions removed",
    },
    401: UNAUTHENTICATED_401,
    409: errorResponse(
      "Blocked: the caller is the last commissioner of a non-empty active league (ADR-0004) — promote a replacement first",
    ),
    500: MISCONFIGURED_500,
  },
});

export function meRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  app.use("/me", requireSession(deps));
  // GET /me only needs db, but the middleware resolves clock too when
  // configured — cheap, and keeps one guard for the whole sub-app instead of
  // per-handler variants.
  app.use("/me", requireDbAndClock(deps));

  // Whether the simulator exists here at all (ADR-0011): the real gate is that
  // `/api/sim/*` is not registered when it doesn't, so this only tells the SPA
  // whether to render sim surfaces — it grants nothing.
  const capabilities = { simEnabled: deps.env ? isSimEnabled(deps.env) : false };

  app.openapi(getMe, async (c) => {
    const db = c.get("db");
    const sessionUser = c.get("sessionUser");
    const user = await getUser(db, sessionUser.id);
    if (!user) {
      // Session cookie is still valid but the user row is gone (e.g. deleted
      // mid-session) — treat it as unauthenticated rather than 404ing /me.
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.UNAUTHENTICATED,
          message: "Sign in to continue.",
        }),
        401,
      );
    }

    return c.json(serializeMe(user, capabilities), 200);
  });

  app.openapi(updateMe, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { username, displayName } = c.req.valid("json");

    const result = await updateProfile(db, clock, sessionUser.id, { username, displayName });
    if (!result.ok) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.USERNAME_TAKEN,
          message: "That username is already taken.",
        }),
        409,
      );
    }

    return c.json(serializeMe(result.user, capabilities), 200);
  });

  app.openapi(deleteMe, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");

    const result = await deleteAccount(db, clock, sessionUser.id);
    if (!result.ok) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.LAST_COMMISSIONER,
          message:
            "You're the last commissioner of a league with other members — promote a replacement first.",
        }),
        409,
      );
    }

    return c.body(null, 204);
  });

  return app;
}
