import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  CreateInviteRequestSchema,
  ERROR_CODE,
  ErrorResponseSchema,
  InviteSchema,
  InvitesResponseSchema,
  JOIN_BLOCKED_REASON_MESSAGES,
  JoinPreviewResponseSchema,
  LeagueResponseSchema,
} from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { requireDbAndClock, requireSession, type DepsVariables } from "../lib/require-deps";
import {
  errorResponse,
  LEAGUE_NOT_FOUND_404,
  MISCONFIGURED_500,
  NOT_COMMISSIONER_403,
  UNAUTHENTICATED_401,
} from "../lib/route-responses";
import type { SessionVariables } from "../middleware/session";
import {
  createInvite,
  getJoinPreview,
  joinByCode,
  listInvites,
  revokeInvite,
} from "../services/invites";

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
    400: errorResponse("Invalid expiry (in the past) or max-use bound"),
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
    404: errorResponse("League or invite not found (or caller not a member)"),
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
    404: errorResponse("Unknown invite code"),
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
    404: errorResponse("Unknown invite code"),
    409: errorResponse(
      "Join refused: invite revoked/expired/exhausted, already a member, league concluded, join cutoff passed, or league full — `error` carries the exact reason",
    ),
    500: MISCONFIGURED_500,
  },
});

export function inviteRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables & DepsVariables }>({
    defaultHook: zodValidationHook,
  });

  for (const path of [
    "/leagues/:leagueId/invites",
    "/leagues/:leagueId/invites/:code",
    "/join/:code",
  ]) {
    app.use(path, requireSession(deps));
    app.use(path, requireDbAndClock(deps));
  }

  app.openapi(postInvite, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await createInvite(db, clock, leagueId, sessionUser.id, {
      expiresAt: body.expiresAt !== undefined ? new Date(body.expiresAt) : undefined,
      maxUses: body.maxUses,
    });
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.LEAGUE_NOT_FOUND,
              message: "League not found.",
            }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.NOT_COMMISSIONER,
              message: "Only a commissioner can manage invites.",
            }),
            403,
          );
        case "expiry_in_past":
          return c.json(
            ErrorResponseSchema.parse({
              error: ERROR_CODE.VALIDATION,
              message: "Invite expiry must be in the future.",
            }),
            400,
          );
      }
    }

    return c.json(result.invite, 201);
  });

  app.openapi(getInvites, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId } = c.req.valid("param");

    const result = await listInvites(db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      if (result.reason === "league_not_found") {
        return c.json(
          ErrorResponseSchema.parse({
            error: ERROR_CODE.LEAGUE_NOT_FOUND,
            message: "League not found.",
          }),
          404,
        );
      }
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.NOT_COMMISSIONER,
          message: "Only a commissioner can manage invites.",
        }),
        403,
      );
    }

    return c.json({ invites: result.invites }, 200);
  });

  app.openapi(deleteInvite, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { leagueId, code } = c.req.valid("param");

    const result = await revokeInvite(db, clock, leagueId, code, sessionUser.id);
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
              error: ERROR_CODE.NOT_COMMISSIONER,
              message: "Only a commissioner can manage invites.",
            }),
            403,
          );
      }
    }

    return c.body(null, 204);
  });

  app.openapi(getJoin, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { code } = c.req.valid("param");

    const preview = await getJoinPreview(db, clock, code, sessionUser.id);
    if (!preview) {
      return c.json(
        ErrorResponseSchema.parse({
          error: ERROR_CODE.INVITE_INVALID,
          message: "That invite link isn't valid.",
        }),
        404,
      );
    }

    return c.json(preview, 200);
  });

  app.openapi(postJoin, async (c) => {
    const db = c.get("db");
    const clock = c.get("clock");
    const sessionUser = c.get("sessionUser");
    const { code } = c.req.valid("param");

    const result = await joinByCode(db, clock, code, sessionUser.id);
    if (!result.ok) {
      if (result.reason === "invite_invalid") {
        return c.json(
          ErrorResponseSchema.parse({
            error: ERROR_CODE.INVITE_INVALID,
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
