import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  CreateInviteRequestSchema,
  ErrorResponseSchema,
  InviteSchema,
  InvitesResponseSchema,
  JOIN_BLOCKED_REASON_MESSAGES,
  JoinPreviewResponseSchema,
  LeagueResponseSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { sessionMiddleware, type SessionVariables } from "../middleware/session";
import {
  createInvite,
  getJoinPreview,
  joinByCode,
  listInvites,
  revokeInvite,
} from "../services/invites";

const MISCONFIGURED_500 = {
  description:
    "Server misconfiguration — structurally unreachable outside generate-openapi.ts, which builds the app with no deps and only ever requests the spec document, never invoking this handler.",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const UNAUTHENTICATED_401 = {
  description: "No valid session",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const NOT_COMMISSIONER_403 = {
  description: "The caller is a member but not a commissioner",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const LEAGUE_NOT_FOUND_404 = {
  description:
    "No such league, or the caller is not a member — indistinguishable so private leagues stay hidden",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

const LeagueIdParamsSchema = z.object({ leagueId: z.uuid() });
const InviteCodeParamsSchema = z.object({ code: z.string().min(1) });
const LeagueInviteParamsSchema = z.object({ leagueId: z.uuid(), code: z.string().min(1) });

const postInvite = createRoute({
  method: "post",
  path: "/leagues/{leagueId}/invites",
  operationId: "createInvite",
  summary: "Generate an invite link code (commissioner, anytime)",
  request: {
    params: LeagueIdParamsSchema,
    body: { content: { "application/json": { schema: CreateInviteRequestSchema } } },
  },
  responses: {
    201: {
      description: "Invite created",
      content: { "application/json": { schema: InviteSchema } },
    },
    400: {
      description: "Invalid expiry (in the past) or max-use bound",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const getInvites = createRoute({
  method: "get",
  path: "/leagues/{leagueId}/invites",
  operationId: "listInvites",
  summary: "List a league's invites with derived status (commissioner)",
  request: { params: LeagueIdParamsSchema },
  responses: {
    200: {
      description: "All invites for the league, newest first",
      content: { "application/json": { schema: InvitesResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: LEAGUE_NOT_FOUND_404,
    500: MISCONFIGURED_500,
  },
});

const deleteInvite = createRoute({
  method: "delete",
  path: "/leagues/{leagueId}/invites/{code}",
  operationId: "revokeInvite",
  summary: "Revoke an invite (commissioner, anytime; idempotent)",
  request: { params: LeagueInviteParamsSchema },
  responses: {
    204: { description: "Invite revoked (or already was)" },
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: {
      description: "League or invite not found (or caller not a member)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

const getJoin = createRoute({
  method: "get",
  path: "/join/{code}",
  operationId: "getJoinPreview",
  summary: "Preview the league behind an invite code and whether a join would succeed",
  request: { params: InviteCodeParamsSchema },
  responses: {
    200: {
      description:
        "League summary + joinability; `reason` explains exactly why a join would be refused",
      content: { "application/json": { schema: JoinPreviewResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    404: {
      description: "Unknown invite code",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

const postJoin = createRoute({
  method: "post",
  path: "/join/{code}",
  operationId: "joinByCode",
  summary: "Join the league behind an invite code",
  request: { params: InviteCodeParamsSchema },
  responses: {
    201: {
      description: "Joined — the league as the new member sees it",
      content: { "application/json": { schema: LeagueResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    404: {
      description: "Unknown invite code",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description:
        "Join refused: invite revoked/expired/exhausted, already a member, league concluded, join cutoff passed, or league full — `error` carries the exact reason",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

export function inviteRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables }>({ defaultHook: zodValidationHook });

  for (const path of [
    "/leagues/:leagueId/invites",
    "/leagues/:leagueId/invites/:code",
    "/join/:code",
  ]) {
    app.use(path, async (c, next) => {
      if (!deps.auth) {
        return c.json(
          ErrorResponseSchema.parse({ error: "misconfigured", message: "Auth is not configured." }),
          500,
        );
      }
      return sessionMiddleware(deps.auth)(c, next);
    });
  }

  app.openapi(postInvite, async (c) => {
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
    const { leagueId } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await createInvite(deps.db, clock, leagueId, sessionUser.id, {
      expiresAt: body.expiresAt !== undefined ? new Date(body.expiresAt) : undefined,
      maxUses: body.maxUses,
    });
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
          return c.json(
            ErrorResponseSchema.parse({ error: "league_not_found", message: "League not found." }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: "not_commissioner",
              message: "Only a commissioner can manage invites.",
            }),
            403,
          );
        case "expiry_in_past":
          return c.json(
            ErrorResponseSchema.parse({
              error: "validation",
              message: "Invite expiry must be in the future.",
            }),
            400,
          );
      }
    }

    return c.json(result.invite, 201);
  });

  app.openapi(getInvites, async (c) => {
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
    const { leagueId } = c.req.valid("param");

    const result = await listInvites(deps.db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      if (result.reason === "league_not_found") {
        return c.json(
          ErrorResponseSchema.parse({ error: "league_not_found", message: "League not found." }),
          404,
        );
      }
      return c.json(
        ErrorResponseSchema.parse({
          error: "not_commissioner",
          message: "Only a commissioner can manage invites.",
        }),
        403,
      );
    }

    return c.json({ invites: result.invites }, 200);
  });

  app.openapi(deleteInvite, async (c) => {
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
    const { leagueId, code } = c.req.valid("param");

    const result = await revokeInvite(deps.db, clock, leagueId, code, sessionUser.id);
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
        case "invite_not_found":
          return c.json(
            ErrorResponseSchema.parse({
              error: result.reason,
              message:
                result.reason === "league_not_found" ? "League not found." : "Invite not found.",
            }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: "not_commissioner",
              message: "Only a commissioner can manage invites.",
            }),
            403,
          );
      }
    }

    return c.body(null, 204);
  });

  app.openapi(getJoin, async (c) => {
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
    const { code } = c.req.valid("param");

    const preview = await getJoinPreview(deps.db, clock, code, sessionUser.id);
    if (!preview) {
      return c.json(
        ErrorResponseSchema.parse({
          error: "invite_invalid",
          message: "That invite link isn't valid.",
        }),
        404,
      );
    }

    return c.json(preview, 200);
  });

  app.openapi(postJoin, async (c) => {
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
    const { code } = c.req.valid("param");

    const result = await joinByCode(deps.db, clock, code, sessionUser.id);
    if (!result.ok) {
      if (result.reason === "invite_invalid") {
        return c.json(
          ErrorResponseSchema.parse({
            error: "invite_invalid",
            message: "That invite link isn't valid.",
          }),
          404,
        );
      }
      return c.json(
        ErrorResponseSchema.parse({
          error: result.reason,
          message: JOIN_BLOCKED_REASON_MESSAGES[result.reason],
        }),
        409,
      );
    }

    return c.json(result.league, 201);
  });

  return app;
}
