import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ErrorResponseSchema, UpdateMemberRoleRequestSchema } from "@picksleagues/schemas";
import type { AppDeps } from "../deps";
import { zodValidationHook } from "../lib/default-hook";
import { sessionMiddleware, type SessionVariables } from "../middleware/session";
import { kickMember, leaveLeague, updateMemberRole } from "../services/members";

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

const LeagueIdParamsSchema = z.object({ leagueId: z.uuid() });
const MemberParamsSchema = z.object({ leagueId: z.uuid(), memberId: z.uuid() });

const patchMember = createRoute({
  method: "patch",
  path: "/leagues/{leagueId}/members/{memberId}",
  operationId: "updateMemberRole",
  summary: "Promote or demote a member (commissioner, anytime; ADR-0004)",
  request: {
    params: MemberParamsSchema,
    body: { content: { "application/json": { schema: UpdateMemberRoleRequestSchema } } },
  },
  responses: {
    204: { description: "Role updated (no-op if it already matched)" },
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: {
      description: "League or member not found (or caller not a member of the league)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description:
        "Promotion past the recipient's 10-active-league cap (cap_exceeded), or a demotion that would leave zero commissioners (last_commissioner)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

const deleteMember = createRoute({
  method: "delete",
  path: "/leagues/{leagueId}/members/{memberId}",
  operationId: "kickMember",
  summary: "Kick a member, pre-start only (commissioner)",
  request: { params: MemberParamsSchema },
  responses: {
    204: { description: "Member removed" },
    400: {
      description: "A commissioner can't kick themselves — leave (or delete the league) instead",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: UNAUTHENTICATED_401,
    403: NOT_COMMISSIONER_403,
    404: {
      description: "League or member not found (or caller not a member of the league)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description:
        "The league has started (league_started), or the kick would leave zero commissioners (last_commissioner)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

const deleteSelf = createRoute({
  method: "delete",
  path: "/leagues/{leagueId}/members/me",
  operationId: "leaveLeague",
  summary: "Leave a league, pre-start only (spec §Membership, ADR-0004)",
  request: { params: LeagueIdParamsSchema },
  responses: {
    204: { description: "Left the league" },
    401: UNAUTHENTICATED_401,
    404: {
      description: "No such league, or the caller is not a member",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description:
        "The league has started (league_started), the caller is the last commissioner of a league with other members (last_commissioner), or the sole member — delete the league instead (sole_member)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    500: MISCONFIGURED_500,
  },
});

export function memberRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<{ Variables: SessionVariables }>({ defaultHook: zodValidationHook });

  app.use("/leagues/:leagueId/members/*", async (c, next) => {
    if (!deps.auth) {
      return c.json(
        ErrorResponseSchema.parse({ error: "misconfigured", message: "Auth is not configured." }),
        500,
      );
    }
    return sessionMiddleware(deps.auth)(c, next);
  });

  // Registered before the {memberId} routes so the literal "me" segment wins
  // instead of failing the uuid param validation.
  app.openapi(deleteSelf, async (c) => {
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

    const result = await leaveLeague(deps.db, clock, leagueId, sessionUser.id);
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
          return c.json(
            ErrorResponseSchema.parse({ error: "league_not_found", message: "League not found." }),
            404,
          );
        case "league_started":
          return c.json(
            ErrorResponseSchema.parse({
              error: "league_started",
              message: "Membership is frozen once the league starts.",
            }),
            409,
          );
        case "sole_member":
          return c.json(
            ErrorResponseSchema.parse({
              error: "sole_member",
              message: "You're the only member — delete the league instead of leaving it.",
            }),
            409,
          );
        case "last_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: "last_commissioner",
              message: "Promote another commissioner before leaving.",
            }),
            409,
          );
      }
    }

    return c.body(null, 204);
  });

  app.openapi(patchMember, async (c) => {
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
    const { leagueId, memberId } = c.req.valid("param");
    const { role } = c.req.valid("json");

    const result = await updateMemberRole(deps.db, clock, leagueId, sessionUser.id, memberId, role);
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
        case "member_not_found":
          return c.json(
            ErrorResponseSchema.parse({
              error: result.reason,
              message:
                result.reason === "league_not_found" ? "League not found." : "Member not found.",
            }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: "not_commissioner",
              message: "Only a commissioner can promote or demote members.",
            }),
            403,
          );
        case "cap_exceeded":
          return c.json(
            ErrorResponseSchema.parse({
              error: "cap_exceeded",
              message: "That member already runs 10 active leagues.",
            }),
            409,
          );
        case "last_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: "last_commissioner",
              message: "A league must keep at least one commissioner.",
            }),
            409,
          );
      }
    }

    return c.body(null, 204);
  });

  app.openapi(deleteMember, async (c) => {
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
    const { leagueId, memberId } = c.req.valid("param");

    const result = await kickMember(deps.db, clock, leagueId, sessionUser.id, memberId);
    if (!result.ok) {
      switch (result.reason) {
        case "league_not_found":
        case "member_not_found":
          return c.json(
            ErrorResponseSchema.parse({
              error: result.reason,
              message:
                result.reason === "league_not_found" ? "League not found." : "Member not found.",
            }),
            404,
          );
        case "not_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: "not_commissioner",
              message: "Only a commissioner can kick members.",
            }),
            403,
          );
        case "cannot_kick_self":
          return c.json(
            ErrorResponseSchema.parse({
              error: "cannot_kick_self",
              message: "You can't kick yourself — leave the league instead.",
            }),
            400,
          );
        case "league_started":
          return c.json(
            ErrorResponseSchema.parse({
              error: "league_started",
              message: "Membership is frozen once the league starts.",
            }),
            409,
          );
        case "last_commissioner":
          return c.json(
            ErrorResponseSchema.parse({
              error: "last_commissioner",
              message: "A league must keep at least one commissioner.",
            }),
            409,
          );
      }
    }

    return c.body(null, 204);
  });

  return app;
}
